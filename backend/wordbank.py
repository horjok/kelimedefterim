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
- Phrasal verb'ler (level = "PV"; kullanıcı isteği, 16 Kasım 2026): adaylar phrasal_verbs.py'deki elle yazılmış
  sözlükten, Türkçe anlam da oradan gelir (çeviriye gönderilmez, Gemini değiştirmez); örnek sözlükten, yoksa Gemini
  yazar. cache/wordbank/PV.json.
- get_words(level, count, exclude, topic) → haznede yeterli kelime yoksa bir kez doldurur, rastgele kelime döndürür.
- Denetim (review_words): otomatik hazırlanan kayıtları Gemini denetler (kullanıcı istekleri, 16 Kasım 2026):
  yanlış Türkçe anlamı ve türü düzeltir ("trSrc": "gemini"), eksik ya da uygunsuz örnek cümleyi yeniden yazar
  ("exSrc": "gemini"). Denetlenen kayıt "chk": 1 alır. Gemini'ye ulaşılamazsa kayıt olduğu gibi kalır ve
  kartlar yine gelir.
Anlamlar otomatik çeviridir, hata içerebilir. Haznede daha önce Gemini ile üretilmiş kayıtlar durabilir ("src" alanı yok).

İspanyolca (20 Kasım 2026, çoklu dil adım 3): adaylar spanish.ranks() sıklık sırasındaki yalın hâllerden
(seviye bantları spanish.LEVEL_RANKS; temel ve görev kelimeleri, -rse biçimleri, İngilizce kelimeler ve kaba
kelimeler elenir). Türkçe anlam translate_all(..., "es"), örnek cümle Wiktionary REST uç noktasından
(fetch_example_es), Türkçesi yine çeviriden. Denetim İspanyolca istemiyle (REVIEW_PROMPT_ES) yapılır; model özel ad,
marka ya da İngilizce kelime gördüğünde "drop" der, kayıt "drop": 1 alır ve gösterilmez. Hazne es/wordbank/<seviye>.json.
Konulu listeler web/data/kelime-konulari-es.json (31 konu, B1/B2/C1, 1302 kelime; aynı konu anahtarları, özgün liste).
İçe aktarılan liste ve phrasal verb'ler yalnızca İngilizcede.
"""

import html
import json
import random
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from wordfreq import top_n_list, zipf_frequency

from . import german, languages, spanish, storage
from .config import CACHE_DIR, WEB_DIR
from .gemini import GeminiError, as_text, generate_json   # Gemini yalnızca hazır kayıtları denetler (review_words)
from .ipa import word_to_ipa
from .lessons import PERSONAS, TEACHER_PERSONA
from .phrasal_verbs import PHRASAL_VERBS
from .vocab import LEVELS, POS_NAMES, analyze_word, cache_lock, google_translate, is_basic, meaning_of, save_translations, translate_all, translation_query, translations, translations_for

CANDIDATE_POOL = 25000   # wordfreq'in en sık kaç kelimesine bakılır
MIN_LENGTH = 3
MAX_COUNT = 30           # bir istekte en çok döndürülen kelime
WORD_ONLY = re.compile(r"^[a-z]+$")
# Sıklık listesinde çıkan ama çalışma kelimesi olarak istenmeyenler (küfür, kaba argo).
BLOCKED = {
    "shit", "fuck", "fucking", "bitch", "porn", "crap", "damn", "hell", "ass", "dick", "cock", "pussy", "slut",
    "whore", "bastard", "piss", "sex", "sexy", "nude", "naked", "rape", "nazi", "gay", "lesbian", "homo",
}
SPANISH_WORD = re.compile(r"^[a-záéíóúüñ]+$")
SPANISH_BLOCKED = {
    "mierda", "puta", "puto", "joder", "coño", "polla", "culo", "cabrón", "gilipollas", "follar", "hostia", "pene",
    "sexo", "sexual", "maricón", "verga", "chingar", "pendejo", "porno", "desnudo", "violación", "nazi", "gay",
    "lesbiana", "concha", "pinche", "carajo", "zorra", "idiota", "estúpido",
}
SPANISH_POS = {"fiil": "VERB", "zarf": "ADV"}  # spanish.pos_of → vocab.POS_NAMES etiketi
# Almanca (21 Kasım 2026): isimler büyük harfle yazılır ve öyle saklanır (Tisch); karşılaştırmalar küçük harfle.
GERMAN_WORD = re.compile(r"^[A-Za-zÄÖÜäöüß][a-zäöüß]+$")
GERMAN_BLOCKED = {
    "scheiße", "scheisse", "ficken", "arsch", "arschloch", "fotze", "hure", "schwanz", "wichser", "schlampe", "nazi",
    "porno", "sex", "sexy", "nackt", "vergewaltigung", "idiot", "verdammt", "schwul", "lesbe", "titten", "kacke",
    "pisse", "mist", "depp", "trottel", "kotzen", "scheissen", "scheißen", "kacken", "geil",
}
GERMAN_POS = {"fiil": "VERB", "zarf": "ADV", "isim": "NOUN", "sıfat": "ADJ"}  # german.pos_of → POS_NAMES etiketi
# İngilizce dışındaki diller: dil paketi, kelime deseni, engelli kelimeler, tür eşlemesi
FOREIGN = {
    "es": {"pack": spanish, "word": SPANISH_WORD, "blocked": SPANISH_BLOCKED, "pos": SPANISH_POS},
    "de": {"pack": german, "word": GERMAN_WORD, "blocked": GERMAN_BLOCKED, "pos": GERMAN_POS},
}
bank_lock = threading.Lock()
candidate_cache = None   # {"A1": [kelime, ...], ...}; ilk istekte bir kez hesaplanır
foreign_cache = {}       # dil -> İngilizce dışındaki dillerin adayları, aynı biçim
bank_cache = {}          # seviye (İngilizce) ya da (dil, seviye) -> {kelime: kayıt}


def foreign_candidates(lang):
    """İspanyolca/Almanca adaylar: sıklık sırasındaki yalın hâller, seviyesine göre (sık kullanılandan seyreğe).
    Almanca isimler büyük harfle döner (simplemma'nın yazımı: Tisch)."""
    if lang not in foreign_cache:
        conf = FOREIGN[lang]
        pack = conf["pack"]
        rank = pack.ranks()
        result = {level: [] for level in LEVELS}
        for key in sorted(rank, key=rank.get):
            lemma = pack.headword(key) if lang == "de" else pack.lemma_of(key)
            same = (lambda text: pack.fold(text) == key) if lang == "de" else (lambda text: text.lower() == key)
            if (lemma is None or len(key) < MIN_LENGTH or not conf["word"].match(lemma) or key in conf["blocked"]
                    or (lang == "de" and not re.search(r"[aeiouyäöü]", key))  # bzw, usw
                    or (lang == "es" and key.endswith("rse")) or pack.is_basic(lemma) or not same(lemma)
                    or not pack.simplemma.is_known(lemma, lang=pack.LANG)):
                continue
            if zipf_frequency(key, "en") > zipf_frequency(key, lang) + 1:
                continue  # bu dildeki metinlerde geçen İngilizce kelime ("the")
            result[pack.level_of(lemma)].append((lemma, conf["pos"].get(pack.pos_of(lemma, lemma))))
        foreign_cache[lang] = result
    return foreign_cache[lang]


def candidates(lang="en"):
    """Seviyelere göre aday kelimeler (sık kullanılandan seyreğe). İlk çağrıda hesaplanır, bellekte kalır."""
    global candidate_cache
    if lang != "en":
        return foreign_candidates(lang)
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


TOPIC_FILES = {"en": "kelime-konulari.json", "es": "kelime-konulari-es.json", "de": "kelime-konulari-de.json"}


def load_topics(lang="en"):
    """Konulu kelime listeleri: {konu: {"tr": ad, "words": {seviye: [kelimeler]}}}. Dosya her istekte okunur."""
    try:
        data = json.loads((WEB_DIR / "data" / TOPIC_FILES[lang]).read_text(encoding="utf-8"))
        return {topic["key"]: topic for topic in data["topics"]}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def topic_words(topic, level, lang="en"):
    """Konunun o seviyedeki kelimeleri (tür tahminiyle): [(kelime, tür | None)]."""
    entry = load_topics(lang).get(topic)
    if entry is None:
        raise GeminiError("Böyle bir kelime konusu yok.", 400, "bad_request")
    if lang != "en":
        conf = FOREIGN[lang]
        return [(word, conf["pos"].get(conf["pack"].pos_of(word, word))) for word in entry.get("words", {}).get(level, [])
                if isinstance(word, str) and conf["word"].match(word) and word.lower() not in conf["blocked"]]
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


def list_sources(lang="en"):
    """Arayüz için: listenin adı ve seviye başına kelime sayısı (içe aktarılan liste yalnızca İngilizce)."""
    data = load_list() if lang == "en" else {}
    return {"name": as_text(data.get("name"), 40), "levels": {level: len(words) for level, words in data.get("levels", {}).items()}}


def list_words(level):
    words = load_list().get("levels", {}).get(level, [])
    if not words:
        raise GeminiError("Bu seviye için içe aktarılmış kelime listesi yok (python -m backend.import_wordlist liste.pdf).", 404, "no_content")
    return [(word, pos) for word, pos in words if isinstance(word, str) and WORD_ONLY.match(word) and word not in BLOCKED]


PHRASAL_LEVEL = "PV"     # get_words(level=...) için özel seviye: phrasal verb'ler (cache/wordbank/PV.json)
PHRASE_ONLY = re.compile(r"^[a-z]+( [a-z]+){1,3}$")


def phrasal_pool():
    """phrasal_verbs.py'deki elle yazılmış phrasal verb'ler: [(ifade, "VERB")]. CEFR seviyeleri olmadığı için tek havuz."""
    return [(phrase, "VERB") for phrase in PHRASAL_VERBS if PHRASE_ONLY.match(phrase)]


def phrase_ipa(phrase):
    """Çok kelimeli ifadenin IPA'sı (kelime kelime); bir kelime sözlükte yoksa boş."""
    pieces = [word_to_ipa(word) for word in phrase.split()]
    return " ".join(pieces) if all(pieces) else ""


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
                # Sözlükteki bazı "örnekler" kaynak alıntısıdır (yıl, tırnak, parantez) ya da kaba kelime içerir: atla
                if re.search(r"\d{4}|[\"“”()\[\]]", example) or BLOCKED & set(re.findall(r"[a-z]+", example.lower())):
                    continue
                if len(re.findall(rf"\b{re.escape(word)}\b", example, flags=re.IGNORECASE)) != 1:
                    continue
                example = example[0].upper() + example[1:] + ("" if example[-1] in ".!?" else ".")
                if meaning.get("partOfSpeech") == DICT_POS.get(pos):
                    return example  # kelimenin listedeki türüyle eşleşen ilk örnek
                found = found or example
    return found


WIKTIONARY_URL = "https://en.wiktionary.org/api/rest_v1/page/definition/"
WIKTIONARY_POS = {"NOUN": "Noun", "VERB": "Verb", "ADJ": "Adjective", "ADV": "Adverb"}


def plain_text(markup):
    """Wiktionary'nin HTML parçasını düz metne çevirir."""
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", str(markup or ""))).split())


def fetch_example_es(entry, lang="es"):
    """Wiktionary'den (İngilizce Vikisözlük, dilin bölümü: es, de) kelimenin örnek cümlesi; kurallar fetch_example ile aynı.
    Uygun örnek yoksa "", istek başarısız olduysa None."""
    word, pos = entry
    blocked = FOREIGN[lang]["blocked"]
    try:
        request = urllib.request.Request(WIKTIONARY_URL + urllib.parse.quote(word), headers={
            "User-Agent": "kelime-defteri/1.0 (yerel dil ogrenme uygulamasi)", "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=6) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return "" if exc.code == 404 else None
    except Exception:
        return None
    found = ""
    for item in (data.get(lang) if isinstance(data, dict) else None) or []:
        if not isinstance(item, dict):
            continue
        for definition in item.get("definitions") or []:
            if not isinstance(definition, dict):
                continue
            texts = [plain_text(sample.get("example")) for sample in definition.get("parsedExamples") or [] if isinstance(sample, dict)]
            texts += [plain_text(sample) for sample in definition.get("examples") or [] if isinstance(sample, str)]
            for example in texts:
                example = as_text(example, 200)
                if not 4 <= len(example.split()) <= 20:
                    continue
                if re.search(r"\d{4}|[\"“”«»„()\[\]]", example) or blocked & set(re.findall(r"\w+", example.lower())):
                    continue
                if len(re.findall(rf"(?<!\w){re.escape(word)}(?!\w)", example, flags=re.IGNORECASE)) != 1:
                    continue
                example = example[0].upper() + example[1:] + ("" if example[-1] in ".!?…" else ".")
                if item.get("partOfSpeech") == WIKTIONARY_POS.get(pos):
                    return example
                found = found or example
    return found


EXAMPLE_FETCHERS = {"en": lambda entry: fetch_example(entry), "es": fetch_example_es,
                    "de": lambda entry: fetch_example_es(entry, "de")}


def translate_examples(sentences, lang="en"):
    """Örnek cümlelerin Türkçesini tek istekte getirir ("§cümle" anahtarıyla); olmazsa cümleler çevirisiz kalır."""
    store = translations_for(lang)  # İngilizcede vocab.translations ile aynı sözlük
    missing = [text for text in dict.fromkeys(sentences) if "§" + text not in store]
    if not missing:
        return
    try:
        results = google_translate(missing, lang)
    except Exception:
        return
    if len(results) == len(missing):
        with cache_lock:
            for text, result in zip(missing, results):
                store["§" + text] = result
            save_translations(lang)


def retry_examples(level, words, lang="en"):
    """Sözlüğe ulaşılamadığı için örneksiz kalmış ("retry") kelimelerin örneğini bir kez daha arar."""
    bank = load_bank(level, lang)
    pending = [word for word in words if bank[word].get("retry")][:DICT_BATCH]
    if not pending:
        return
    pos_of = {name: tag for tag, name in POS_NAMES.items()}
    fetch = EXAMPLE_FETCHERS[lang]
    found = {}
    for word in pending:
        found[word] = fetch((word, pos_of.get(bank[word].get("pos"))))
        if found[word] is None:
            break  # sözlük yine yanıt vermiyor: kullanıcıyı bekletme, kalanlar sonraki istekte denenir
    translate_examples([text for text in found.values() if text], lang)
    store = translations_for(lang)
    for word, example in found.items():
        if example is None:
            continue  # yine ulaşılamadı; işaret kalır
        bank[word].pop("retry", None)
        if example:
            bank[word]["example"] = example
            bank[word]["exampleTr"] = store.get("§" + example, "")
    save_bank(level, lang)


REVIEW_BATCH = 12        # Gemini'ye bir seferde denetlettirilen kelime
REVIEW_TRIES = 2         # bir kelime için en çok bu kadar denenir (model atlarsa sonsuza dek sorulmasın)
REVIEW_PROMPT = """Your learner is building vocabulary at CEFR level {level}.{topic} The entries below were prepared
automatically: the Turkish meaning comes from machine translation of the single word (no context) and the example
sentence from a dictionary. Check and repair each entry.

Return ONLY a JSON object with this exact shape:
{{"words": [{{"word": "the word exactly as given", "pos": "noun | verb | adjective | adverb", "tr": "Turkish meaning", "example": "English sentence", "exampleTr": "Turkish translation of the sentence"}}]}}

Rules:
- "tr": the most common, everyday meaning of the word{topic_rule}, in 1 to 3 Turkish words (verbs as infinitives
  ending in -mek / -mak). If the given Turkish meaning is already right, return it unchanged. Replace it when it is
  wrong, unnatural, a rare sense, or not a real Turkish word. No explanations, no alternatives separated by slashes.
- "pos": the part of speech that matches your "tr".
- "example": if the given example is a natural sentence that shows the word in the meaning of your "tr", return it
  unchanged. Otherwise (or when it says NONE) write a new natural sentence of 6 to 14 words at {level} level.
  Either way the sentence must contain the word EXACTLY as given (same form, not inflected) exactly once.
- "exampleTr": a natural, correct Turkish translation of the sentence you return.
- Leave a word out completely only if it is a person's name, a place or brand name, vulgar, or not a real English word.

Entries (word | part of speech | Turkish meaning | example):
{words}"""
REVIEW_PROMPT_ES = """Your learner is building Spanish vocabulary at CEFR level {level}.{topic} The entries below were prepared
automatically: the Turkish meaning comes from machine translation of the single word (no context) and the example
sentence from a dictionary (Wiktionary). Check and repair each entry.

Return ONLY a JSON object with this exact shape:
{{"words": [{{"word": "the word exactly as given", "drop": false, "pos": "noun | verb | adjective | adverb | other", "tr": "Turkish meaning", "example": "Spanish sentence", "exampleTr": "Turkish translation of the sentence"}}]}}

Rules:
- "drop": true if the word is a person's name, a place or brand name, vulgar, an English word, or not a real
  Spanish word (then the other fields may be empty). Otherwise false.
- "tr": the most common, everyday meaning of the word{topic_rule}, in 1 to 3 Turkish words (verbs as infinitives
  ending in -mek / -mak). If the given Turkish meaning is already right, return it unchanged. Replace it when it is wrong,
  unnatural, a rare sense, or not a real Turkish word. No explanations, no alternatives separated by slashes.
- "pos": the part of speech that matches your "tr".
- "example": if the given example is a natural sentence that shows the word in the meaning of your "tr", return it
  unchanged. Otherwise (or when it says NONE) write a new natural sentence of 6 to 14 words at {level} level in the
  Spanish of Spain, with correct accents and ¿ ¡ marks. Either way the sentence must contain the word EXACTLY as
  given (verbs in the infinitive, nouns and adjectives in the given form, not inflected) exactly once.
- "exampleTr": a natural, correct Turkish translation of the sentence you return.

Entries (word | part of speech | Turkish meaning | example):
{words}"""
REVIEW_PROMPT_DE = """Your learner is building German vocabulary at CEFR level {level}.{topic} The entries below were prepared
automatically: the Turkish meaning comes from machine translation of the single word (no context) and the example
sentence from a dictionary (Wiktionary). Check and repair each entry.

Return ONLY a JSON object with this exact shape:
{{"words": [{{"word": "the word exactly as given", "drop": false, "pos": "noun | verb | adjective | adverb | other", "article": "der | die | das | empty", "tr": "Turkish meaning", "example": "German sentence", "exampleTr": "Turkish translation of the sentence"}}]}}

Rules:
- "drop": true if the word is a person's name, a place or brand name, vulgar, an English word, or not a real
  German word (then the other fields may be empty). Otherwise false.
- "article": for nouns the definite article of the singular in the nominative (der, die or das); for every other
  part of speech an empty string. German nouns are written with a capital letter.
- "tr": the most common, everyday meaning of the word{topic_rule}, in 1 to 3 Turkish words (verbs as infinitives
  ending in -mek / -mak). If the given Turkish meaning is already right, return it unchanged. Replace it when it is wrong,
  unnatural, a rare sense, or not a real Turkish word. No explanations, no alternatives separated by slashes.
- "pos": the part of speech that matches your "tr".
- "example": if the given example is a natural sentence that shows the word in the meaning of your "tr", return it
  unchanged. Otherwise (or when it says NONE) write a new natural sentence of 6 to 14 words at {level} level in
  standard German (Hochdeutsch) with correct spelling (ä, ö, ü, ß). Either way the sentence must contain the word
  EXACTLY as given (same letters and capitalisation; verbs in the infinitive, for example after a modal verb or "zu";
  nouns in the given singular form) exactly once.
- "exampleTr": a natural, correct Turkish translation of the sentence you return.

Entries (word | part of speech | Turkish meaning | example):
{words}"""
REVIEW_PROMPTS = {"es": REVIEW_PROMPT_ES, "de": REVIEW_PROMPT_DE}
ARTICLES = ("der", "die", "das")
POS_FROM_MODEL = {"verb": "fiil", "noun": "isim", "adjective": "sıfat", "adverb": "zarf"}
# Phrasal verb'lerde Türkçe anlam elle yazıldı (phrasal_verbs.py) ve değiştirilmez; model yalnızca örneği denetler.
PHRASAL_PROMPT = """Your learner is studying common English phrasal verbs (around B1-B2 level). Each entry below has a
hand-written Turkish meaning (several senses are separated by ";") and, when available, an example sentence taken from
a dictionary. Check and repair the examples.

Return ONLY a JSON object with this exact shape:
{{"words": [{{"word": "the phrasal verb exactly as given", "example": "English sentence", "exampleTr": "Turkish translation of the sentence"}}]}}

Rules:
- "example": if the given example is a natural, everyday sentence that clearly shows one of the given Turkish
  meanings, return it unchanged. Otherwise (or when it says NONE) write a new natural sentence of 6 to 14 words at
  B1 level that shows the first Turkish meaning.
- The sentence must contain the phrasal verb EXACTLY as given, exactly once: the words next to each other in the given
  order with nothing between them, in the base form (for example after "to", "can", "will", "don't", or as an
  imperative), not inflected.
- "exampleTr": a natural, correct Turkish translation of the sentence you return.

Entries (phrasal verb | Turkish meaning | example):
{words}"""


def review_words(level, words, topic="", lang="en"):
    """Otomatik hazırlanmış kayıtları (src = "sozluk") Gemini'ye denetletir: Türkçe anlamı ve türü düzeltir,
    eksik ya da uygunsuz örnek cümleyi yeniden yazar (kullanıcı istekleri, 16 Kasım 2026: "boşta kalan kısımları
    Gemini ile doldur", "anlamları da denetlet"). Denetlenen kayıt "chk": 1 alır ve bir daha sorulmaz.
    Gemini'ye ulaşılamazsa False döner; kayıtlar olduğu gibi kalır."""
    bank = load_bank(level, lang)
    pending = [word for word in words
               if bank[word].get("src") == "sozluk" and not bank[word].get("chk") and bank[word].get("gap", 0) < REVIEW_TRIES]
    pending = pending[:REVIEW_BATCH]
    if not pending:
        return True
    phrasal = level == PHRASAL_LEVEL
    listing = "\n".join(
        f"{word} | {bank[word].get('pos') or '?'} | {bank[word]['tr']} | {bank[word].get('example') or 'NONE'}" for word in pending)
    if lang != "en":
        prompt = REVIEW_PROMPTS[lang].format(
            level=level, words=listing,
            topic=f' The words belong to the vocabulary topic "{topic}".' if topic else "",
            topic_rule=f' within the topic "{topic}"' if topic else "")
    elif phrasal:
        prompt = PHRASAL_PROMPT.format(words="\n".join(
            f"{word} | {bank[word]['tr']} | {bank[word].get('example') or 'NONE'}" for word in pending))
    else:
        prompt = REVIEW_PROMPT.format(
            level=level, words=listing,
            topic=f' The words belong to the vocabulary topic "{topic}".' if topic else "",
            topic_rule=f' within the topic "{topic}"' if topic else "")
    try:
        raw, _model = generate_json(prompt, temperature=0.2, system=PERSONAS.get(lang, TEACHER_PERSONA))
    except GeminiError:
        return False  # anahtar yok, kota, ağ: kayıtlar denetlenmeden kalır, sonra yeniden denenir
    for word in pending:
        bank[word]["gap"] = bank[word].get("gap", 0) + 1
    by_key = {word.lower(): word for word in pending}  # Almanca isimler büyük harfle saklanır; model küçük yazabilir
    for item in (raw.get("words") if isinstance(raw, dict) else None) or []:
        if not isinstance(item, dict):
            continue
        word = by_key.get(" ".join(as_text(item.get("word"), 40).lower().split()))
        if word is None or bank[word].get("chk"):
            continue
        entry = bank[word]
        if lang != "en" and item.get("drop") is True:
            entry.update({"drop": 1, "chk": 1})  # özel ad, marka, İngilizce ya da kaba kelime: gösterilmez
            entry.pop("gap", None)
            continue
        model_pos = as_text(item.get("pos"), 12).lower()
        if lang == "de" and model_pos in POS_FROM_MODEL and (model_pos == "noun") != word[:1].isupper():
            # Sıklık listesi küçük harfli olduğundan yazım tahmin edildi; model türü başka diyorsa (Hart ↔ hart) gösterme
            entry.update({"drop": 1, "chk": 1})
            entry.pop("gap", None)
            continue
        if lang == "de" and word[:1].isupper():
            article = as_text(item.get("article"), 3).lower()
            if article in ARTICLES:
                entry["art"] = article  # der / die / das (arayüzde "der Tisch")
        tr = "" if phrasal else as_text(item.get("tr"), 60)
        if tr and tr.lower() != word.lower() and "/" not in tr:
            tr = tr[0].lower() + tr[1:]
            if tr != entry["tr"]:
                entry["tr"] = tr
                entry["trSrc"] = "gemini"  # anlam yapay zekâ tarafından düzeltildi
            pos = POS_FROM_MODEL.get(as_text(item.get("pos"), 12).lower())
            if pos:
                entry["pos"] = pos
        example = as_text(item.get("example"), 200)
        # Kelime cümlede tam olarak bir kez, aynı biçimde geçmeli (boşluk doldurma sorusu bunu kullanır)
        if 4 <= len(example.split()) <= 20 and len(re.findall(rf"\b{re.escape(word)}\b", example, flags=re.IGNORECASE)) == 1:
            if example != entry.get("example"):
                entry["example"] = example
                entry["exSrc"] = "gemini"  # örnek cümle yapay zekâ üretimi
            entry["exampleTr"] = as_text(item.get("exampleTr"), 240) or entry.get("exampleTr", "")
        entry["chk"] = 1
        entry.pop("retry", None)
        entry.pop("gap", None)
    save_bank(level, lang)
    return True


def fill_from_dictionary(level, exclude, pool, frequent=False, lang="en"):
    """Adaylardan bir grup kelimeyi Gemini'siz hazırlar: anlam çeviri uç noktasından, örnek sözlükten.
    frequent: adaylar sıklık sırasındaysa (karışık mod) en sık 400 yeni kelimeden seçilir.
    Örneği bulunamayan kelime örneksiz eklenir (Cümle aşamasında Türkçe → İngilizce sorulur)."""
    bank = load_bank(level, lang)
    fresh = [(word, pos) for word, pos in pool if word not in bank and word.lower() not in exclude]
    if not fresh:
        return 0
    if frequent:
        fresh = fresh[:400]
    batch = random.sample(fresh, min(DICT_BATCH, len(fresh)))
    phrasal = level == PHRASAL_LEVEL  # phrasal verb'lerin anlamı elle yazıldı; çeviriye gönderilmez
    english = lang == "en"
    fetch = EXAMPLE_FETCHERS[lang]
    if phrasal:
        error = None
    elif english:
        error = translate_all([translation_query(word, pos) for word, pos in batch])
    else:
        # İspanyolca mastar Türkçe mastar olarak döner; Almanca fiil "zu" ile sorulur (zu wohnen → yaşamak)
        error = translate_all([foreign_query(word, pos, lang) for word, pos in batch], lang)
    with ThreadPoolExecutor(max_workers=DICT_WORKERS) as workers:
        examples = dict(zip((word for word, _pos in batch), workers.map(fetch, batch)))
    for word, pos in batch:  # başarısız istekler (None) bir kez de tek tek denenir
        if examples[word] is None:
            examples[word] = fetch((word, pos))
            if examples[word] is None:
                break  # sözlük yanıt vermiyor: beklemeyi uzatma, kalanlar "retry" ile sonra denenir
    translate_examples([text for text in examples.values() if text], lang)
    store = translations_for(lang)
    added = 0
    for word, pos in batch:
        if phrasal:
            tr = PHRASAL_VERBS.get(word, "")
        elif english:
            tr = meaning_of(word, pos)
        else:
            tr = store.get(foreign_query(word, pos, lang), "")
            tr = "" if tr.lower() == word.lower() else tr
        if not tr:
            continue  # çeviri gelmedi ya da kelime aynen döndü
        example = examples.get(word)
        bank[word] = {
            "tr": tr[0].lower() + tr[1:], "pos": "phrasal verb" if phrasal else POS_NAMES.get(pos, ""),
            "ipa": phrase_ipa(word) if phrasal else word_to_ipa(word) if english else FOREIGN[lang]["pack"].word_to_ipa(word),
            "example": example or "", "exampleTr": store.get("§" + example, "") if example else "",
            "zipf": round(zipf_frequency(word, lang), 2), "src": "sozluk",
        }
        if example is None:
            bank[word]["retry"] = 1  # sözlüğe ulaşılamadı: kelime sonra istendiğinde örnek yeniden aranır
        added += 1
    if added:
        save_bank(level, lang)
    elif error:
        raise GeminiError(error, 503, "network")
    return added


def foreign_query(word, pos, lang):
    return f"zu {word}" if lang == "de" and pos == "VERB" else word


def bank_key(level, lang):
    return level if lang == "en" else (lang, level)


def load_bank(level, lang="en"):
    key = bank_key(level, lang)
    if key not in bank_cache:
        data = storage.read(languages.storage_name(lang, f"wordbank/{level}.json"), {})
        bank_cache[key] = data if isinstance(data, dict) else {}
    return bank_cache[key]


def save_bank(level, lang="en"):
    storage.merge_write(languages.storage_name(lang, f"wordbank/{level}.json"), bank_cache[bank_key(level, lang)])


def get_words(level, count, exclude=(), topic="", lang="en"):
    """Seviyeden rastgele `count` kelime: [{word, tr, pos, ipa, example, exampleTr, level}]. exclude: istenmeyen kelimeler."""
    if lang != "en" and (level not in LEVELS or topic == LIST_TOPIC):
        raise GeminiError("Bu dilde yalnızca A1–C2 seviyeleri ve konulu listeler var (phrasal verb ve içe aktarılan liste yok).", 400, "bad_request")
    if level not in LEVELS and level != PHRASAL_LEVEL:
        raise GeminiError("Seviye A1, A2, B1, B2, C1, C2 ya da PV (phrasal verbs) olmalı.", 400, "bad_request")
    count = max(1, min(MAX_COUNT, count))
    exclude = {" ".join(str(word).lower().split()) for word in exclude}
    phrasal = level == PHRASAL_LEVEL
    if phrasal:
        topic = ""  # phrasal verb'lerin konusu yok
    with bank_lock:
        bank = load_bank(level, lang)
        # topic: kelime konusu anahtarı (yalnızca B1, B2, C1 listeleri var); boşsa seviyenin bütün kelimeleri
        pool = (phrasal_pool() if phrasal else list_words(level) if topic == LIST_TOPIC
                else topic_words(topic, level, lang) if topic else None)
        wanted = None if pool is None else {word for word, _pos in pool}

        def usable():
            return [word for word in bank
                    if word.lower() not in exclude and not bank[word].get("drop") and (wanted is None or word in wanted)]

        available = usable()
        error = None
        if len(available) < count:
            try:
                if pool is None:
                    fill_from_dictionary(level, exclude, candidates(lang)[level], frequent=True, lang=lang)
                else:
                    fill_from_dictionary(level, exclude, pool, lang=lang)
            except GeminiError as exc:
                error = exc  # haznede kelime varsa onlarla devam edilir
            available = usable()
        if not available:
            if error is not None:
                raise error
            raise GeminiError("Burada gösterilecek yeni kelime kalmadı. Başka bir konu ya da seviye seç.", 404, "no_content")
        chosen = random.sample(available, min(count, len(available)))
        # Otomatik hazırlanan kayıtları Gemini denetler (anlam, tür, örnek); ona ulaşılamazsa sözlük bir kez daha denenir
        if not review_words(level, chosen, "" if topic == LIST_TOPIC else topic, lang):
            retry_examples(level, chosen, lang)
        # Denetim bazı kelimeleri gösterilmez yaptıysa (İspanyolcada "drop") onları çıkar
        chosen = [word for word in chosen if not bank[word].get("drop")]
        return {
            "level": level, "topic": topic, "bankSize": len(bank),
            "candidates": len(candidates(lang)[level]) if pool is None else len(pool),
            "words": [{"word": word, "level": "" if phrasal else level, **{k: v for k, v in bank[word].items() if k not in ("zipf", "retry", "gap", "chk", "drop")}} for word in chosen],
        }
