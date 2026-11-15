"""
Pekiştir sayfası için seviyeli kelime haznesi.

- Adaylar: wordfreq'in en sık 25.000 İngilizce kelimesi; seviye ve tür vocab.analyze_word ile (cefrpy) bulunur.
  Yalnızca yalın hâldeki kelimeler alınır; çok yaygın "temel" kelimeler (vocab.is_basic) atılır.
- Anlam ve örnek (fill_from_dictionary): Gemini KULLANILMAZ (kullanıcı isteği, 15 Kasım 2026). Türkçe anlam
  vocab.py'deki çeviri uç noktasından, örnek cümle Free Dictionary API'den (Wiktionary), cümlenin Türkçesi yine
  çeviri uç noktasından gelir; cache/wordbank/<seviye>.json içinde saklanır. Hazne zamanla büyür; aynı kelime
  için ikinci kez istek atılmaz. Örneği bulunamayan kelime örneksiz saklanır.
- Konulu kelimeler: web/data/kelime-konulari.json içinde konu başına B1 / B2 / C1 kelime listeleri (elle, özgün
  yazıldı). Konu seçilirse adaylar sıklık listesinden değil o konunun listesinden gelir.
- Kendi kelime listen (topic = "liste"): backend/import_wordlist.py ile içe aktarılan PDF listesi
  (cache/wordlists/liste.json; depoya girmez).
- get_words(level, count, exclude, topic) → haznede yeterli kelime yoksa bir kez doldurur, rastgele kelime döndürür.
Anlamlar otomatik çeviridir, hata içerebilir. Haznede daha önce Gemini ile üretilmiş kayıtlar durabilir ("src" alanı yok).
"""

import json
import random
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from wordfreq import top_n_list, zipf_frequency

from .config import CACHE_DIR, WEB_DIR
from .gemini import GeminiError, as_text   # GeminiError: /api/* hata sınıfı olarak (istek Gemini'ye gitmez)
from .ipa import word_to_ipa
from .vocab import LEVELS, POS_NAMES, analyze_word, cache_lock, google_translate, is_basic, meaning_of, save_translations, translate_all, translation_query, translations

BANK_DIR = CACHE_DIR / "wordbank"
CANDIDATE_POOL = 25000   # wordfreq'in en sık kaç kelimesine bakılır
MIN_LENGTH = 3
MAX_COUNT = 30           # bir istekte en çok döndürülen kelime
WORD_ONLY = re.compile(r"^[a-z]+$")
# Sıklık listesinde çıkan ama çalışma kelimesi olarak istenmeyenler (küfür, kaba argo).
BLOCKED = {
    "shit", "fuck", "fucking", "bitch", "porn", "crap", "damn", "hell", "ass", "dick", "cock", "pussy", "slut",
    "whore", "bastard", "piss", "sex", "sexy", "nude", "naked", "rape", "nazi", "gay", "lesbian", "homo",
}
bank_lock = threading.Lock()
candidate_cache = None   # {"A1": [kelime, ...], ...}; ilk istekte bir kez hesaplanır
bank_cache = {}          # seviye -> {kelime: kayıt}


def candidates():
    """Seviyelere göre aday kelimeler (sık kullanılandan seyreğe). İlk çağrıda hesaplanır, bellekte kalır."""
    global candidate_cache
    if candidate_cache is None:
        result = {level: [] for level in LEVELS}
        for word in top_n_list("en", CANDIDATE_POOL):
            if len(word) < MIN_LENGTH or not WORD_ONLY.match(word) or word in BLOCKED:
                continue
            info = analyze_word(word)
            # Yalın hâl ve türü bilinen kelimeler: "running", "london" gibi çekimli ve özel adlar elenir
            if info is None or info["pos"] is None or info["lemma"] != word:
                continue
            if is_basic(word, info["level"]):
                continue
            result[info["level"]].append((word, info["pos"]))
        candidate_cache = result
    return candidate_cache


def load_topics():
    """Konulu kelime listeleri: {konu: {"tr": ad, "words": {seviye: [kelimeler]}}}. Dosya her istekte okunur."""
    try:
        data = json.loads((WEB_DIR / "data" / "kelime-konulari.json").read_text(encoding="utf-8"))
        return {topic["key"]: topic for topic in data["topics"]}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def topic_words(topic, level):
    """Konunun o seviyedeki kelimeleri (tür tahminiyle): [(kelime, tür | None)]."""
    entry = load_topics().get(topic)
    if entry is None:
        raise GeminiError("Böyle bir kelime konusu yok.", 400, "bad_request")
    result = []
    for word in entry.get("words", {}).get(level, []):
        if isinstance(word, str) and WORD_ONLY.match(word) and word not in BLOCKED:
            info = analyze_word(word)
            # Tür tahmini yalnızca kelime kendi yalın hâliyse güvenilir ("swollen" → swell fiili sanılmasın)
            result.append((word, info["pos"] if info and info["lemma"] == word else None))
    return result


LIST_FILE = CACHE_DIR / "wordlists" / "liste.json"   # import_wordlist.py yazar
LIST_TOPIC = "liste"                                 # get_words(topic=...) için özel anahtar
DICT_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/"
DICT_BATCH = 12          # sözlükten bir seferde hazırlanan kelime (kelime başına bir istek)
DICT_WORKERS = 3         # aynı anda en çok bu kadar sözlük isteği (fazlası boş yanıtlara yol açıyordu)
DICT_POS = {"NOUN": "noun", "VERB": "verb", "ADJ": "adjective", "ADV": "adverb"}


def load_list():
    """İçe aktarılan liste: {"name": ad, "levels": {seviye: [[kelime, tür | None]]}}; yoksa boş."""
    try:
        data = json.loads(LIST_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data.get("levels"), dict) else {}
    except (OSError, ValueError, AttributeError):
        return {}


def list_sources():
    """Arayüz için: listenin adı ve seviye başına kelime sayısı."""
    data = load_list()
    return {"name": as_text(data.get("name"), 40), "levels": {level: len(words) for level, words in data.get("levels", {}).items()}}


def list_words(level):
    words = load_list().get("levels", {}).get(level, [])
    if not words:
        raise GeminiError("Bu seviye için içe aktarılmış kelime listesi yok (python -m backend.import_wordlist liste.pdf).", 404, "no_content")
    return [(word, pos) for word, pos in words if isinstance(word, str) and WORD_ONLY.match(word) and word not in BLOCKED]


def fetch_example(entry):
    """Free Dictionary API'den kelimenin örnek cümlesi; kelime cümlede aynı biçimde tam bir kez geçmeli.
    Uygun örnek yoksa "", istek başarısız olduysa (ağ hatası, sınırlama) None döner: None sonra yeniden denenir."""
    word, pos = entry
    try:
        request = urllib.request.Request(DICT_URL + urllib.parse.quote(word), headers={"User-Agent": "kelime-defteri"})
        with urllib.request.urlopen(request, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return "" if exc.code == 404 else None  # 404: sözlükte bu kelime yok
    except Exception:
        return None
    found = ""
    for item in data if isinstance(data, list) else []:
        for meaning in item.get("meanings", []) if isinstance(item, dict) else []:
            for definition in meaning.get("definitions", []):
                example = as_text(definition.get("example"), 200)
                if not 4 <= len(example.split()) <= 20:
                    continue
                if len(re.findall(rf"\b{re.escape(word)}\b", example, flags=re.IGNORECASE)) != 1:
                    continue
                example = example[0].upper() + example[1:] + ("" if example[-1] in ".!?" else ".")
                if meaning.get("partOfSpeech") == DICT_POS.get(pos):
                    return example  # kelimenin listedeki türüyle eşleşen ilk örnek
                found = found or example
    return found


def translate_examples(sentences):
    """Örnek cümlelerin Türkçesini tek istekte getirir ("§cümle" anahtarıyla); olmazsa cümleler çevirisiz kalır."""
    missing = [text for text in dict.fromkeys(sentences) if "§" + text not in translations]
    if not missing:
        return
    try:
        results = google_translate(missing)
    except Exception:
        return
    if len(results) == len(missing):
        with cache_lock:
            for text, result in zip(missing, results):
                translations["§" + text] = result
            save_translations()


def retry_examples(level, words):
    """Sözlüğe ulaşılamadığı için örneksiz kalmış ("retry") kelimelerin örneğini bir kez daha arar."""
    bank = load_bank(level)
    pending = [word for word in words if bank[word].get("retry")][:DICT_BATCH]
    if not pending:
        return
    pos_of = {name: tag for tag, name in POS_NAMES.items()}
    found = {}
    for word in pending:
        found[word] = fetch_example((word, pos_of.get(bank[word].get("pos"))))
        if found[word] is None:
            break  # sözlük yine yanıt vermiyor: kullanıcıyı bekletme, kalanlar sonraki istekte denenir
    translate_examples([text for text in found.values() if text])
    for word, example in found.items():
        if example is None:
            continue  # yine ulaşılamadı; işaret kalır
        bank[word].pop("retry", None)
        if example:
            bank[word]["example"] = example
            bank[word]["exampleTr"] = translations.get("§" + example, "")
    save_bank(level)


def fill_from_dictionary(level, exclude, pool, frequent=False):
    """Adaylardan bir grup kelimeyi Gemini'siz hazırlar: anlam çeviri uç noktasından, örnek sözlükten.
    frequent: adaylar sıklık sırasındaysa (karışık mod) en sık 400 yeni kelimeden seçilir.
    Örneği bulunamayan kelime örneksiz eklenir (Cümle aşamasında Türkçe → İngilizce sorulur)."""
    bank = load_bank(level)
    fresh = [(word, pos) for word, pos in pool if word not in bank and word not in exclude]
    if not fresh:
        return 0
    if frequent:
        fresh = fresh[:400]
    batch = random.sample(fresh, min(DICT_BATCH, len(fresh)))
    error = translate_all([translation_query(word, pos) for word, pos in batch])
    with ThreadPoolExecutor(max_workers=DICT_WORKERS) as workers:
        examples = dict(zip((word for word, _pos in batch), workers.map(fetch_example, batch)))
    for word, pos in batch:  # başarısız istekler (None) bir kez de tek tek denenir
        if examples[word] is None:
            examples[word] = fetch_example((word, pos))
            if examples[word] is None:
                break  # sözlük yanıt vermiyor: beklemeyi uzatma, kalanlar "retry" ile sonra denenir
    translate_examples([text for text in examples.values() if text])
    added = 0
    for word, pos in batch:
        tr = meaning_of(word, pos)
        if not tr:
            continue  # çeviri gelmedi ya da kelime aynen döndü
        example = examples.get(word)
        bank[word] = {
            "tr": tr[0].lower() + tr[1:], "pos": POS_NAMES.get(pos, ""), "ipa": word_to_ipa(word),
            "example": example or "", "exampleTr": translations.get("§" + example, "") if example else "",
            "zipf": round(zipf_frequency(word, "en"), 2), "src": "sozluk",
        }
        if example is None:
            bank[word]["retry"] = 1  # sözlüğe ulaşılamadı: kelime sonra istendiğinde örnek yeniden aranır
        added += 1
    if added:
        save_bank(level)
    elif error:
        raise GeminiError(error, 503, "network")
    return added


def load_bank(level):
    if level not in bank_cache:
        try:
            data = json.loads((BANK_DIR / f"{level}.json").read_text(encoding="utf-8"))
            bank_cache[level] = data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            bank_cache[level] = {}
    return bank_cache[level]


def save_bank(level):
    BANK_DIR.mkdir(parents=True, exist_ok=True)
    (BANK_DIR / f"{level}.json").write_text(json.dumps(bank_cache[level], ensure_ascii=False, indent=0), encoding="utf-8")


def get_words(level, count, exclude=(), topic=""):
    """Seviyeden rastgele `count` kelime: [{word, tr, pos, ipa, example, exampleTr, level}]. exclude: istenmeyen kelimeler."""
    if level not in LEVELS:
        raise GeminiError("Seviye A1, A2, B1, B2, C1 ya da C2 olmalı.", 400, "bad_request")
    count = max(1, min(MAX_COUNT, count))
    exclude = {str(word).lower() for word in exclude}
    with bank_lock:
        bank = load_bank(level)
        # topic: kelime konusu anahtarı (yalnızca B1, B2, C1 listeleri var); boşsa seviyenin bütün kelimeleri
        pool = list_words(level) if topic == LIST_TOPIC else topic_words(topic, level) if topic else None
        wanted = None if pool is None else {word for word, _pos in pool}

        def usable():
            return [word for word in bank if word not in exclude and (wanted is None or word in wanted)]

        available = usable()
        error = None
        if len(available) < count:
            try:
                if pool is None:
                    fill_from_dictionary(level, exclude, candidates()[level], frequent=True)
                else:
                    fill_from_dictionary(level, exclude, pool)
            except GeminiError as exc:
                error = exc  # haznede kelime varsa onlarla devam edilir
            available = usable()
        if not available:
            if error is not None:
                raise error
            raise GeminiError("Burada gösterilecek yeni kelime kalmadı. Başka bir konu ya da seviye seç.", 404, "no_content")
        chosen = random.sample(available, min(count, len(available)))
        retry_examples(level, chosen)
        return {
            "level": level, "topic": topic, "bankSize": len(bank),
            "candidates": len(candidates()[level]) if pool is None else len(pool),
            "words": [{"word": word, "level": level, **{k: v for k, v in bank[word].items() if k not in ("zipf", "retry")}} for word in chosen],
        }
