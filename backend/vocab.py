"""
Transkriptten kelime listesi çıkarır:
- Her kelimenin yalın hali (running -> run) ve CEFR seviyesi (A1...C2)  -> cefrpy + lemminflect
- Phrasal verb'ler (pick up, pick it up, come up with)                 -> phrasal_verbs.py
- Türkçe anlamlar                                                      -> Google Translate (önbellekli)
- Çok yaygın (temel) kelimeleri ana listeden ayırma                     -> wordfreq
"""

import json
import re
import threading
import urllib.parse
import urllib.request

from cefrpy import CEFRAnalyzer
from lemminflect import getAllLemmas
from wordfreq import zipf_frequency

from .config import CACHE_DIR
from .phrasal_verbs import OBJECT_PRONOUNS, PHRASAL_VERBS, SEPARABLE_PARTICLES

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
POS_TAGS = {"VERB": "VB", "NOUN": "NN", "ADJ": "JJ", "ADV": "RB"}
POS_ORDER = {"VERB": 0, "NOUN": 1, "ADJ": 2, "ADV": 3}
POS_NAMES = {"VERB": "fiil", "NOUN": "isim", "ADJ": "sıfat", "ADV": "zarf"}

WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")
TAGS = re.compile(r"[\[(][^\])]*[\])]")  # (Laughter), [Music]

# Kısa görev kelimeleri: bağlamsız çeviride yanlış çıkıyor (of -> "arasında"),
# bu yüzden anlamları ve türleri elle yazıldı.
FUNCTION_WORDS = {
    # tanımlık / belirteç
    "the": ("tanımlık", "belirli tanımlık (Türkçede karşılığı yok)"),
    "a": ("tanımlık", "bir"),
    "an": ("tanımlık", "bir"),
    "this": ("belirteç", "bu"),
    "these": ("belirteç", "bunlar"),
    "those": ("belirteç", "şunlar"),
    "some": ("belirteç", "biraz, bazı"),
    "any": ("belirteç", "hiç, herhangi"),
    "every": ("belirteç", "her"),
    "each": ("belirteç", "her bir"),
    "all": ("belirteç", "hepsi, bütün"),
    "no": ("belirteç", "hiç; hayır"),
    # zamir
    "i": ("zamir", "ben"),
    "you": ("zamir", "sen, siz"),
    "he": ("zamir", "o (erkek)"),
    "she": ("zamir", "o (kadın)"),
    "it": ("zamir", "o (cansız, hayvan)"),
    "we": ("zamir", "biz"),
    "they": ("zamir", "onlar"),
    "me": ("zamir", "beni, bana"),
    "him": ("zamir", "onu, ona (erkek)"),
    "her": ("zamir", "onu, ona; onun (kadın)"),
    "us": ("zamir", "bizi, bize"),
    "them": ("zamir", "onları, onlara"),
    "my": ("zamir", "benim"),
    "your": ("zamir", "senin, sizin"),
    "his": ("zamir", "onun (erkek)"),
    "its": ("zamir", "onun (cansız)"),
    "our": ("zamir", "bizim"),
    "their": ("zamir", "onların"),
    "who": ("zamir", "kim; ki o"),
    "what": ("zamir", "ne"),
    "which": ("zamir", "hangi; ki o"),
    "that": ("zamir", "şu, o; ki"),
    # edat
    "of": ("edat", "-in, -ın (iyelik); -den"),
    "to": ("edat", "-e, -a; -mek için"),
    "in": ("edat", "içinde, -de"),
    "on": ("edat", "üzerinde, -de"),
    "at": ("edat", "-de, -da"),
    "for": ("edat", "için; -dir (süre)"),
    "with": ("edat", "ile, -le"),
    "from": ("edat", "-den, -dan"),
    "by": ("edat", "tarafından; yanında"),
    "about": ("edat", "hakkında; yaklaşık"),
    "into": ("edat", "içine"),
    "as": ("edat", "olarak; gibi"),
    "like": ("edat", "gibi; sevmek"),
    # bağlaç
    "and": ("bağlaç", "ve"),
    "but": ("bağlaç", "ama"),
    "or": ("bağlaç", "veya"),
    "so": ("bağlaç", "bu yüzden; çok"),
    "because": ("bağlaç", "çünkü"),
    "if": ("bağlaç", "eğer"),
    "when": ("bağlaç", "ne zaman; -dığında"),
    "than": ("bağlaç", "-den (daha)"),
}

analyzer = CEFRAnalyzer()
word_cache = {}


# ===== Temel kelimeler =====
# Uygulama temelleri oturmuş öğrenciler için. Çok yaygın kelimeler (you, get, think...) ana listede
# yer kaplamasın, ayrı "Temel" grubuna gitsin; öne daha az kullanılan, öğrenmeye değer kelimeler çıksın.
# Ölçü: wordfreq Zipf sıklığı. 7 ≈ "the", 6 ≈ "know", 5 ≈ milyonda 100 ("door"), 4 ≈ milyonda 10 ("knife").
BASIC_ZIPF = {"A1": 5.0, "A2": 5.3}  # bu seviyelerde bu sıklık ve üstü temel sayılır
VERY_COMMON_ZIPF = 6.0               # her seviyede bu sıklık ve üstü temel sayılır


def is_basic(word, level):
    if word in FUNCTION_WORDS:  # tanımlık, zamir, edat, bağlaç: kelime değil gramer
        return True
    frequency = zipf_frequency(word, "en")
    return frequency >= VERY_COMMON_ZIPF or frequency >= BASIC_ZIPF.get(level, 99)


# ===== Kelime: yalın hal + seviye =====

def to_level(value):
    index = min(len(LEVELS), max(1, round(value))) - 1
    return LEVELS[index]


def analyze_word(word):
    """'shoes' -> {'lemma': 'shoe', 'pos': 'NOUN', 'level': 'A1'}  /  sözlükte yoksa None.

    Bir kelimenin birden çok türü olabilir (shoe: isim A1, fiil 'nallamak' C2).
    En kolay seviyedeki tür, kelimenin en yaygın kullanımıdır; onu seçiyoruz."""
    if word in word_cache:
        return word_cache[word]

    candidates = []
    for pos, lemmas in getAllLemmas(word).items():
        if pos not in POS_TAGS:
            continue
        lemma = lemmas[0]
        level = analyzer.get_word_pos_level_float(lemma, POS_TAGS[pos])
        if level is not None:
            candidates.append((level, POS_ORDER[pos], lemma, pos))

    if candidates:
        level, _, lemma, pos = min(candidates)
        result = {"lemma": lemma, "pos": pos, "level": to_level(level)}
    else:
        level = analyzer.get_average_word_level_float(word)
        result = None if level is None else {"lemma": word, "pos": None, "level": to_level(level)}

    word_cache[word] = result
    return result


# ===== Phrasal verb bulma =====

# "pick" -> [(("up",), "pick up"), ...]  (uzun olanlar önce: "come up with" > "come up")
PHRASALS_BY_VERB = {}
for _key in PHRASAL_VERBS:
    _verb, *_particles = _key.split(" ")
    PHRASALS_BY_VERB.setdefault(_verb, []).append((tuple(_particles), _key))
for _list in PHRASALS_BY_VERB.values():
    _list.sort(key=lambda item: -len(item[0]))


def verb_lemmas(token):
    return getAllLemmas(token).get("VERB", ())


def find_phrasals(tokens):
    """tokens: küçük harfli kelimeler. Bulunan phrasal verb anahtarlarını döndürür."""
    found = []
    for i, token in enumerate(tokens):
        match = None
        for verb in verb_lemmas(token):
            for particles, key in PHRASALS_BY_VERB.get(verb, []):
                n = len(particles)
                if tuple(tokens[i + 1:i + 1 + n]) == particles:
                    match = key
                # Ayrılabilen: "pick it up", "turn them off"
                elif (
                    n == 1
                    and particles[0] in SEPARABLE_PARTICLES
                    and i + 2 < len(tokens)
                    and tokens[i + 1] in OBJECT_PRONOUNS
                    and tokens[i + 2] == particles[0]
                ):
                    match = key
                if match:
                    break
            if match:
                break
        if match:
            found.append(match)
    return found


# ===== Türkçe çeviri (Google Translate, önbellekli) =====

CACHE_FILE = CACHE_DIR / "translations.json"
TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t"
cache_lock = threading.Lock()


def load_translations():
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


translations = load_translations()


def save_translations():
    CACHE_FILE.parent.mkdir(exist_ok=True)
    CACHE_FILE.write_text(json.dumps(translations, ensure_ascii=False, indent=0), encoding="utf-8")


def google_translate(texts):
    """Birçok ifadeyi tek istekte çevirir: satır satır gönderip satır satır geri alır."""
    body = urllib.parse.urlencode({"q": "\n".join(texts)}).encode()
    request = urllib.request.Request(TRANSLATE_URL, data=body, headers={
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    })
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.loads(response.read().decode("utf-8"))
    text = "".join(segment[0] for segment in data[0] if segment[0])
    return [line.strip() for line in text.split("\n")]


def translate_all(texts):
    """Önbellekte olmayanları 80'erli gruplar halinde çevirir. Hata olursa mesajını döndürür."""
    missing = [t for t in dict.fromkeys(texts) if t not in translations]
    error = None
    for start in range(0, len(missing), 80):
        chunk = missing[start:start + 80]
        try:
            results = google_translate(chunk)
        except Exception as exc:  # ağ hatası, engelleme, beklenmeyen yanıt
            error = f"Çeviri servisine ulaşılamadı ({exc.__class__.__name__}). Anlamlar eksik olabilir."
            break
        if len(results) != len(chunk):
            continue  # satırlar kaydıysa bu grubu atla, yanlış anlam göstermekten iyidir
        with cache_lock:
            for source, result in zip(chunk, results):
                translations[source] = result
    if missing:
        with cache_lock:
            save_translations()
    return error


def translate_sentence(text):
    """Tek bir cümleyi Türkçeye çevirir (önbellekli). Ağ hatasında istisna fırlatır."""
    key = "§" + text  # kelime çevirileriyle karışmasın diye cümle anahtarları § ile başlar
    if key not in translations:
        result = " ".join(google_translate([text])).strip()
        with cache_lock:
            translations[key] = result
            save_translations()
    return translations[key]


def translation_query(lemma, pos):
    # Fiillerin başına "to" koyunca Türkçe mastar gelir: "to run" -> "koşmak"
    return f"to {lemma}" if pos == "VERB" else lemma


def meaning_of(lemma, pos):
    if lemma in FUNCTION_WORDS:
        return FUNCTION_WORDS[lemma][1]
    query = translation_query(lemma, pos)
    result = translations.get(query, "")
    # Çevrilmeden aynen dönen kelimelerin anlamını boş bırak
    if result.lower() in (lemma.lower(), query.lower()):
        return ""
    return result


# ===== Hepsini birleştir =====

def build_vocab(lines, ipa_of, prepare_ipa=None):
    """lines: server.build_lines çıktısı. ipa_of: kelime -> IPA fonksiyonu.
    prepare_ipa: (isteğe bağlı) kelime listesini tek seferde IPA'ya çevirip önbelleğe alır."""
    words = {}     # yalın hal -> bilgi
    phrasals = {}  # phrasal verb -> bilgi
    casing = {}    # kelime -> [küçük harfli görülme, cümle ortasında büyük harfli görülme]

    for line in lines:
        text = TAGS.sub(" ", line["text"]).replace("’", "'")
        raw_tokens = WORD.findall(text)
        tokens = [t.lower() for t in raw_tokens]

        for position, (raw, token) in enumerate(zip(raw_tokens, tokens)):
            stats = casing.setdefault(token, [0, 0])
            if raw[0].islower():
                stats[0] += 1
            elif position > 0:
                stats[1] += 1

            # it's, don't gibi kısaltmalar ve tek harfler kelime listesine girmez
            if "'" in token or (len(token) == 1 and token not in ("a", "i")):
                continue
            info = analyze_word(token)
            if info is None:
                continue
            entry = words.setdefault(info["lemma"], {
                "word": "I" if info["lemma"] == "i" else info["lemma"],
                "pos": info["pos"],
                "level": info["level"],
                "count": 0,
                "start": line["start"],
                "forms": set(),
            })
            entry["count"] += 1
            entry["forms"].add(token)

        for key in find_phrasals(tokens):
            entry = phrasals.setdefault(key, {
                "phrase": key,
                "tr": PHRASAL_VERBS[key],
                "count": 0,
                "start": line["start"],
                "example": line["text"],
            })
            entry["count"] += 1

    # Özel isimler: hiç küçük harfle geçmeyip cümle ortasında büyük harfle geçenler (Robinson, TED)
    def is_proper_noun(entry):
        return all(casing[f][0] == 0 and casing[f][1] > 0 for f in entry["forms"])

    kept = [e for e in words.values() if not is_proper_noun(e) or e["word"] == "I"]

    to_translate = [e for e in kept if e["word"].lower() not in FUNCTION_WORDS]
    error = translate_all([translation_query(e["word"].lower(), e["pos"]) for e in to_translate])
    if prepare_ipa:
        prepare_ipa([e["word"] for e in kept] + [w for key in phrasals for w in key.split(" ")])

    levels = {level: [] for level in LEVELS}
    basic = []  # çok yaygın kelimeler: ayrı grupta, dikte boşluğu olmaz
    for entry in kept:
        key = entry["word"].lower()
        pos_name = FUNCTION_WORDS[key][0] if key in FUNCTION_WORDS else POS_NAMES.get(entry["pos"], "")
        target = basic if is_basic(key, entry["level"]) else levels[entry["level"]]
        target.append({
            "word": entry["word"],
            "pos": pos_name,
            "ipa": ipa_of(entry["word"]),
            "tr": meaning_of(entry["word"].lower(), entry["pos"]),
            "count": entry["count"],
            "start": entry["start"],
            "forms": sorted(entry["forms"]),
            "level": entry["level"],
        })
    for items in [*levels.values(), basic]:
        items.sort(key=lambda item: (-item["count"], item["word"]))

    phrasal_list = sorted(phrasals.values(), key=lambda item: (-item["count"], item["phrase"]))
    for item in phrasal_list:
        item["ipa"] = " ".join(ipa_of(part) for part in item["phrase"].split(" "))

    return {"levels": levels, "phrasal": phrasal_list, "basic": basic, "translationError": error}
