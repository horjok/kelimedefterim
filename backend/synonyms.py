"""
Eş anlamlılar (Kartlar, Kelimeler ve Sözlük sayfaları): GET /api/synonyms?word=<kelime>

Kullanıcı seçimi (20 Kasım 2026): kaynak Gemini, sonuç saklanır. İspanyolca için ücretsiz ve anahtarsız bir
eş anlamlı sözlüğü yok; İngilizcedeki Free Dictionary listesi de çıplak (Türkçesi ve farkı yok).

Yanıt: {"word", "senses": [{"pos", "tr", "synonyms": [{"word", "tr", "note", "example", "exampleTr"}]}],
        "unknown": bool, "model"}
- Anlamlar kelimenin farklı anlamlarına göre gruplanır (book: rezervasyon yapmak / kitap).
- Kelime başına Gemini bir kez çağrılır; sonuç dile göre saklanır: "synonyms.json", "es/synonyms.json"
  ("de/synonyms.json"; {kelime: kayıt}, anahtar küçük harfli). Eş anlamlısı olmayan ya da tanınmayan kelimenin boş sonucu da saklanır.
"""

import re
import threading
import time

from . import languages, storage
from .gemini import GeminiError, as_text, generate_json

MAX_SENSES = 3
MAX_SYNONYMS = 5
WORD = re.compile(r"^[^\W\d_]+(?:[ '’-][^\W\d_]+){0,3}$")  # harfler; en çok 4 parçalı ifade (pick up, a lo mejor)
POS_NAMES = {"noun": "isim", "verb": "fiil", "adjective": "sıfat", "adverb": "zarf", "phrasal verb": "phrasal verb",
             "preposition": "edat", "conjunction": "bağlaç", "pronoun": "zamir", "interjection": "ünlem",
             "phrase": "ifade", "expression": "ifade"}

LANGUAGE_NAMES = {"en": "English", "es": "Spanish", "de": "German"}
ARTICLES = ("der", "die", "das")

SYSTEM = """You are an experienced {language} teacher and lexicographer who helps Turkish-speaking learners
build vocabulary. You explain in clear, natural Turkish and address the learner as "sen".
You are accurate: you list only real, common synonyms and you do not invent words or meanings.{extra}
You reply with a single JSON object in exactly the requested shape and nothing else."""

SPANISH_EXTRA = """
You teach the Spanish of Spain (castellano peninsular). When a synonym is mainly used in Latin America,
say so in its note. You write Spanish with correct accents (á, é, í, ó, ú, ü, ñ)."""

# Almanca (21 Kasım 2026): isimler büyük harfle; artikel ayrı "article" alanında gelir (kullanıcı seçimi: Gemini eklesin)
GERMAN_EXTRA = """
You teach standard German (Hochdeutsch) and write it with correct spelling (ä, ö, ü, ß). German nouns are always
written with a capital letter. For every synonym that is a noun, add the field "article" with its definite article
in the nominative singular (der, die or das); for all other synonyms "article" is an empty string. When a synonym
is mainly used in Austria or Switzerland, say so in its note. Each synonym object therefore has the shape
{"word": "", "article": "", "tr": "", "note": "", "example": "", "exampleTr": ""}."""
EXTRAS = {"es": SPANISH_EXTRA, "de": GERMAN_EXTRA}

PROMPT = """List the most useful synonyms of the {language} word or phrase "{word}" for a Turkish-speaking learner.

Rules:
- Group the synonyms by meaning (sense) of "{word}". At most {senses} senses, the most common first.
  Skip rare senses. At most {synonyms} synonyms per sense, the closest and most common first.
- Only real synonyms or near-synonyms that can replace "{word}" in at least some sentences of that sense.
  No antonyms, no broader category words, no definitions, no inflected forms of "{word}" itself.
- Each synonym is a single word or a short fixed phrase (at most 4 words) in its dictionary form,
  written in {language}, without articles or explanations in brackets.
- "pos": part of speech in English (noun, verb, adjective, adverb, phrasal verb, phrase…).
- "tr" of a sense: the meaning of "{word}" in that sense, in Turkish (1–4 words).
- "tr" of a synonym: its Turkish meaning (1–4 words).
- "note": one short Turkish sentence on how the synonym differs from "{word}" (more formal, informal,
  stronger, weaker, more specific, used in writing, British or American, regional…).
- "example": one short, natural {language} sentence (5–14 words) that uses the synonym exactly as written.
  "exampleTr": its Turkish translation.
- If "{word}" has no common synonyms (function words, very specific terms), return an empty "senses" list.
- If "{word}" is not a real {language} word or phrase, return {{"senses": [], "unknown": true}}.

Return JSON in this shape:
{{"senses": [{{"pos": "", "tr": "", "synonyms": [{{"word": "", "tr": "", "note": "", "example": "", "exampleTr": ""}}]}}]}}"""

caches = {}  # dil -> {kelime: kayıt}; ilk istekte depodan okunur
cache_lock = threading.Lock()


def storage_name(lang):
    return languages.storage_name(lang, "synonyms.json")


def cache_for(lang):
    with cache_lock:
        if lang not in caches:
            stored = storage.read(storage_name(lang), {})
            caches[lang] = stored if isinstance(stored, dict) else {}
        return caches[lang]


def normalize(word, lang="en"):
    """Boşlukları sadeleştirir. Almancada büyük harf korunur (isimler: Tisch); önbellek anahtarı yine küçük harflidir."""
    text = re.sub(r"\s+", " ", (word or "").strip().replace("’", "'"))[:60]
    return text if lang == "de" else text.lower()


def clean_synonym(raw, head, seen, lang="en"):
    if not isinstance(raw, dict):
        return None
    word = normalize(as_text(raw.get("word"), 60), lang)
    if not WORD.fullmatch(word) or word.lower() == head.lower() or word.lower() in seen:
        return None
    seen.add(word.lower())
    example = as_text(raw.get("example"), 240)
    result = {
        "word": word,
        "tr": as_text(raw.get("tr"), 80),
        "note": as_text(raw.get("note"), 240),
        "example": example,
        "exampleTr": as_text(raw.get("exampleTr"), 240) if example else "",
    }
    article = as_text(raw.get("article"), 3).lower()
    if lang == "de" and article in ARTICLES and word[:1].isupper():
        result["article"] = article
    return result


def clean_senses(raw, head, lang="en"):
    """Model yanıtını alan alan doğrular. Geçersiz eş anlamlılar ve boş kalan anlamlar atılır."""
    senses = []
    seen = set()
    items = raw.get("senses") if isinstance(raw, dict) else None
    for item in (items if isinstance(items, list) else [])[:MAX_SENSES]:
        if not isinstance(item, dict) or not isinstance(item.get("synonyms"), list):
            continue
        synonyms = [s for s in (clean_synonym(entry, head, seen, lang) for entry in item["synonyms"]) if s][:MAX_SYNONYMS]
        if synonyms:
            pos = turkish_pos(as_text(item.get("pos"), 30))
            senses.append({"pos": pos, "tr": as_text(item.get("tr"), 80), "synonyms": synonyms})
    return senses


def turkish_pos(pos):
    """Model türü İngilizce yazar (adverb); uygulamanın her yerinde olduğu gibi Türkçe gösterilir (zarf)."""
    pos = (pos or "").strip().lower()
    return POS_NAMES.get(pos, pos)


def with_turkish_pos(record):
    """Eski kayıtlarda tür İngilizce saklanmış olabilir; döndürürken Türkçeye çevrilir."""
    senses = [dict(sense, pos=turkish_pos(sense.get("pos"))) if isinstance(sense, dict) else sense
              for sense in record.get("senses") or []]
    return {**record, "senses": senses}


def get_synonyms(raw_word, lang="en"):
    word = normalize(raw_word, lang)
    key = word.lower()
    language = LANGUAGE_NAMES.get(lang)
    if not language:
        raise GeminiError("Bu dilde eş anlamlılar henüz yok.", 404, "no_feature")
    if not WORD.fullmatch(word):
        raise GeminiError(f"Tek bir {languages.info(lang)['name']} kelime ya da kısa bir ifade yaz.", 400, "bad_request")

    cache = cache_for(lang)
    saved = cache.get(key)
    if isinstance(saved, dict):
        return {"word": word, **with_turkish_pos(saved)}

    system = SYSTEM.format(language=language, extra=EXTRAS.get(lang, ""))
    prompt = PROMPT.format(language=language, word=word, senses=MAX_SENSES, synonyms=MAX_SYNONYMS)
    data, model = generate_json(prompt, temperature=0.2, system=system)
    senses = clean_senses(data, word, lang)
    record = {"senses": senses, "unknown": bool(isinstance(data, dict) and data.get("unknown")) and not senses,
              "model": model, "at": int(time.time())}
    with cache_lock:
        cache[key] = record
        storage.merge_write(storage_name(lang), cache)
    return {"word": word, **record}
