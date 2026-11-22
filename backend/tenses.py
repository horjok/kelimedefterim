"""
Zaman çizgisi sayfasının cümle dönüştürücüsü (Gramer sayfası, gramer.html#zaman-cizgisi): POST /api/tenses

Kullanıcı seçimi (22 Kasım 2026): karma yol.
- convert(cümle): kural tabanlı, anında. Basit bir ana cümlenin (özne + fiil öbeği + geri kalanı) 12 zamandaki
  olumlu, olumsuz ve soru hâllerini lemminflect ile kurar. Emin olmadığı cümleyi dönüştürmez,
  {"supported": False, "reason": ...} döner (yanlış cümleyi doğru gibi göstermektense).
- convert_ai(cümle): kuralın çözemediği cümle için Gemini; 12 zamanın olumlu hâli + Türkçesi + doğallık notu.
  Sonuç "tenses.json" içinde saklanır ({küçük harfli cümle: kayıt}); aynı cümle Gemini'ye ikinci kez gitmez.

Satır biçimi: {"key", "time", "aspect", "pos": {"text", "parts": [{"t", "r"}]}, "neg", "q", "note", "natural"}.
"r" parçanın rolü: "aux" yardımcı fiil, "neg" not, "verb" fiil gövdesi, "suf" -ing/-ed/-s eki,
"irr" düzensiz biçim (went, gone), "p" noktalama, "" diğerleri. Arayüz rolleri renklendirir.
Yalnızca İngilizce (dil kaydında "tenses" özelliği).
"""

import re
import threading
import time as clock

from lemminflect import getAllLemmas, getInflection, getLemma

from . import storage
from .gemini import GeminiError, as_text, generate_json

TIMES = ("present", "past", "future")
ASPECTS = ("simple", "continuous", "perfect", "perfect-continuous")
TENSES = [f"{t}-{a}" for t in TIMES for a in ASPECTS]   # present-simple … future-perfect-continuous
MAX_LENGTH = 200

PRONOUNS = {"i": "1sg", "you": "pl", "he": "3sg", "she": "3sg", "it": "3sg", "we": "pl", "they": "pl"}
DETERMINERS = {"the", "a", "an", "my", "your", "his", "her", "its", "our", "their", "this", "that", "these",
               "those", "every", "each", "some", "many", "most", "all", "no", "both", "any", "few", "several"}
PLURAL_ONLY = {"people", "police", "cattle", "children", "men", "women", "feet", "teeth", "mice"}
MODALS = {"can", "could", "may", "might", "must", "should", "would", "shall", "ought"}
MID_ADVERBS = {"always", "usually", "often", "sometimes", "never", "rarely", "seldom", "already", "just",
               "still", "ever", "also", "really", "generally", "normally", "hardly", "frequently", "occasionally"}
# until / before / after edat da olabilir (until midnight); yan cümle hâlini "zamir + fiil" denetimi yakalar
SUBORDINATORS = {"because", "when", "while", "if", "who", "which", "where", "whose", "whom",
                 "unless", "although", "though", "whether", "whenever"}
CONJUNCTIONS = {"and", "but", "or"}
STATIVE = {"know", "like", "love", "hate", "want", "need", "believe", "understand", "remember", "own", "belong",
           "prefer", "mean", "seem", "contain", "consist", "deserve", "matter", "wish", "realize", "realise",
           "suppose", "recognize", "recognise", "be", "have", "doubt", "agree", "disagree", "possess"}
BE_FORMS = {"am": "1sg", "is": "3sg", "are": "pl", "was": "past", "were": "past", "'m": "1sg", "'re": "pl"}
NEGATIVE_CONTRACTIONS = {
    "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"], "isn't": ["is", "not"],
    "aren't": ["are", "not"], "wasn't": ["was", "not"], "weren't": ["were", "not"], "hasn't": ["has", "not"],
    "haven't": ["have", "not"], "hadn't": ["had", "not"], "won't": ["will", "not"], "shan't": ["shall", "not"],
    "can't": ["can", "not"], "cannot": ["can", "not"], "couldn't": ["could", "not"], "shouldn't": ["should", "not"],
    "wouldn't": ["would", "not"], "mustn't": ["must", "not"], "mightn't": ["might", "not"],
}
CLITICS = {"'m": "am", "'re": "are", "'ve": "have", "'ll": "will"}
# 's ancak bu kelimelere bitişikse yardımcı fiildir (John's car iyelik kalır)
S_HOSTS = {"he", "she", "it", "that", "what", "who", "where", "here"}

# Zaman zarfları: yalnızca uyduğu zamanlarda kalır, öteki satırlardan çıkar
PAST_POINT = ("past-simple", "past-continuous")
FUTURE_POINT = ("future-simple", "future-continuous")
NOW = ("present-continuous",)
PERFECTS = ("present-perfect", "present-perfect-continuous", "past-perfect", "past-perfect-continuous",
            "future-perfect", "future-perfect-continuous")
UNITS = r"(?:second|minute|hour|day|week|month|year|decade|century)s?"
NUMBER = r"(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twenty|a few|several|many)"
TIME_PATTERNS = [
    (re.compile(r"\byesterday(?: morning| afternoon| evening)?\b", re.I), PAST_POINT),
    (re.compile(r"\blast (?:night|week|month|year|summer|winter|spring|autumn|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.I), PAST_POINT),
    (re.compile(rf"\b{NUMBER} {UNITS} ago\b", re.I), PAST_POINT),
    (re.compile(r"\btomorrow(?: morning| afternoon| evening)?\b", re.I), FUTURE_POINT),
    (re.compile(r"\bnext (?:week|month|year|summer|winter|spring|autumn|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.I), FUTURE_POINT),
    (re.compile(r"\b(?:right now|at the moment|at present|currently|now)\b", re.I), NOW),
    (re.compile(r"\bsince (?:\d{4}|yesterday|last \w+|then|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|childhood|\d+ ?(?:am|pm|o'clock))\b", re.I), PERFECTS),
]

AUX_ROLE = "aux"


class Unsupported(Exception):
    """Kuralın güvenle çözemediği cümle; mesaj Türkçe ve kullanıcıya gösterilir."""


def word_lemmas(word):
    try:
        return getAllLemmas(word.lower())
    except Exception:
        return {}


def is_verb_word(word):
    return "VERB" in word_lemmas(word) or "AUX" in word_lemmas(word)


def verb_lemma(word):
    lemmas = getLemma(word.lower(), upos="VERB")
    return lemmas[0] if lemmas else word.lower()


def inflect(lemma, tag):
    forms = getInflection(lemma, tag=tag)
    return list(forms) if forms else []


def forms_of(lemma, tag):
    return {form.lower() for form in inflect(lemma, tag)}


# ----- 1. Metni parçalara ayırma -----

def tokenize(sentence):
    text = sentence.replace("’", "'").replace("‘", "'").strip()
    text = re.sub(r"\s+", " ", text)
    if not text:
        raise Unsupported("Dönüştürülecek bir cümle yaz.")
    if len(text) > MAX_LENGTH:
        raise Unsupported(f"Cümle çok uzun (en çok {MAX_LENGTH} karakter).")
    if "?" in text:
        raise Unsupported("Soru cümlesini kurallar çeviremiyor; olumlu ya da olumsuz bir cümle yaz.")
    body = re.sub(r"[.!]+$", "", text).strip()
    if re.search(r"[.!;:]", body):
        raise Unsupported("Tek bir cümle yaz (nokta ya da noktalı virgülle ayrılmış birden çok cümle değil).")
    if not re.search(r"[A-Za-z]", body):
        raise Unsupported("Cümlede İngilizce kelime yok.")
    return body


def expand(words):
    """Kısaltmaları açar: doesn't → does not, I've → I have, she's → she 's (sonra is/has diye çözülür)."""
    out = []
    for word in words:
        lower = word.lower()
        if lower in NEGATIVE_CONTRACTIONS:
            first, second = NEGATIVE_CONTRACTIONS[lower]
            out += [word[0] + first[1:] if word[0].isupper() else first, second]
            continue
        match = re.match(r"^([A-Za-z]+)('m|'re|'ve|'ll|'s|'d)$", word, re.I)
        if match:
            host, clitic = match.group(1), match.group(2).lower()
            if clitic == "'s" and host.lower() not in S_HOSTS:
                out.append(word)       # iyelik: John's
                continue
            out += [host, CLITICS.get(clitic, clitic)]
            continue
        out.append(word)
    return out


# ----- 2. Zaman zarfları -----

def pull_time_phrases(body):
    """Bilinen zaman zarflarını cümleden çıkarır: (kalan metin, [{"text", "fits", "front"}])."""
    found = []
    for pattern, fits in TIME_PATTERNS:
        match = pattern.search(body)
        if not match:
            continue
        phrase = match.group(0)
        front = match.start() == 0
        body = (body[:match.start()] + body[match.end():]).strip()
        body = re.sub(r"^,\s*", "", body)
        body = re.sub(r"\s*,\s*$", "", body)
        body = re.sub(r"\s+", " ", body)
        found.append({"text": phrase, "fits": list(fits), "front": front})
    return body, found


# ----- 3. Cümleyi çözümleme -----

def subject_agreement(subject_words, head):
    lower = [w.lower() for w in subject_words]
    if len(lower) == 1 and lower[0] in PRONOUNS:
        return PRONOUNS[lower[0]]
    if "and" in lower:
        return "pl"
    head_lower = head.lower()
    if head_lower in PLURAL_ONLY:
        return "pl"
    nouns = word_lemmas(head_lower).get("NOUN")
    if nouns and head_lower not in nouns and head_lower.endswith("s"):
        return "pl"
    if lower[0] in {"these", "those", "many", "both", "several", "few"}:
        return "pl"
    return "3sg"


def find_subject(words):
    """Öznenin bittiği yeri bulur: (özne kelimeleri, baş isim, fiil öbeğinin başladığı indeks)."""
    first = words[0].lower()
    if first in PRONOUNS:
        return words[:1], words[0], 1
    if first == "there":
        raise Unsupported("'There is / there are' cümlelerini kurallar çeviremiyor.")
    index = 0
    subject = []
    while True:
        start = index
        if index < len(words) and words[index].lower() in DETERMINERS:
            index += 1
        # sıfatlar (yalnızca sıfat olabilen kelimeler)
        while index < len(words) - 1 and set(word_lemmas(words[index])) <= {"ADJ", "ADV"} and word_lemmas(words[index]):
            index += 1
        if index >= len(words):
            raise Unsupported("Cümlenin öznesini bulamadım.")
        head = words[index]                       # baş isim (determiner'dan hemen sonraki kelime fiil sayılmaz)
        index += 1
        # bileşik isim: bus driver, coffee shop (sonraki kelime fiil olamıyorsa ya da arkasından çekimli bir fiil geliyorsa)
        while index < len(words) - 1:
            nxt = words[index]
            if nxt.lower() in MID_ADVERBS or nxt.lower() in CONJUNCTIONS:
                break
            if not is_verb_word(nxt) and "NOUN" in word_lemmas(nxt):
                head = nxt
                index += 1
                continue
            after = words[index + 1].lower()
            lemma = verb_lemma(nxt)
            if nxt.lower() == lemma and is_verb_word(after) and (
                    after in forms_of(verb_lemma(after), "VBZ") or after in forms_of(verb_lemma(after), "VBD")):
                head = nxt
                index += 1
                continue
            break
        subject += words[start:index]
        if index < len(words) - 1 and words[index].lower() == "and":
            subject.append(words[index])
            index += 1
            if words[index].lower() in PRONOUNS:
                subject.append(words[index])
                head = words[index]
                index += 1
                break
            continue
        break
    if index >= len(words):
        raise Unsupported("Cümlenin fiilini bulamadım.")
    return subject, head, index


QUESTION_STARTS = MODALS | {"do", "does", "did", "will", "have", "has", "had", "is", "are", "was", "were", "am"}
# V3'ü yalın hâliyle aynı yazılan fiiller (have cut, have come)
SAME_V3 = {"cut", "put", "hit", "set", "let", "shut", "hurt", "cost", "read", "come", "run", "become", "quit",
           "spread", "bet", "burst", "cast", "fit", "split"}


def is_v3(word):
    if not word or not is_verb_word(word):
        return False
    lower = word.lower()
    lemma = verb_lemma(lower)
    return lower in forms_of(lemma, "VBN") and (lower != lemma or lemma in SAME_V3)


def is_ing(word):
    return bool(word) and word.lower().endswith("ing") and word.lower() != "being" and is_verb_word(word)


def is_base_verb(word):
    return bool(word) and is_verb_word(word) and word.lower() == verb_lemma(word)


def parse(body):
    """Özne + fiil öbeği + geri kalanını bulur: {subject, agr, lemma, adverb, rest, negative, detected}."""
    words = expand(body.replace(",", " , ").split())
    if "," in words:
        raise Unsupported("Virgüllü, birden çok parçalı cümleleri kurallar çeviremiyor.")
    if len(words) < 2:
        raise Unsupported("Cümlede en az bir özne ve bir fiil olmalı.")
    if words[0].lower() in QUESTION_STARTS:
        raise Unsupported("Soru cümlesini kurallar çeviremiyor; olumlu ya da olumsuz bir cümle yaz.")
    subject, head, start = find_subject(words)
    state = {"i": start, "adverb": None, "negative": False}

    def peek(offset=0):
        index = state["i"] + offset
        return words[index].lower() if index < len(words) else ""

    def take_extras():
        """Yardımcıdan sonra gelebilen 'not' ve sıklık zarfı (has not always, has always)."""
        for _ in range(2):
            if peek() == "not" and not state["negative"]:
                state["negative"] = True
                state["i"] += 1
            elif peek() in MID_ADVERBS and state["adverb"] is None:
                state["adverb"] = words[state["i"]]
                state["i"] += 1

    def take_main(check):
        word = words[state["i"]] if state["i"] < len(words) else ""
        if not check(word):
            raise Unsupported("Cümlenin fiil öbeğini çözemedim.")
        state["i"] += 1
        return verb_lemma(word)

    agr = subject_agreement(subject, head)
    time, aspect = "present", "simple"
    take_extras()
    if state["negative"]:
        raise Unsupported("Cümlenin fiilini bulamadım.")
    word = peek()
    if word in MODALS:
        raise Unsupported("Modal fiilli (can, must, would…) cümleleri kurallar çeviremiyor.")
    if word == "'d":
        raise Unsupported("'d kısaltması (had / would) belirsiz; açık yaz: I had… ya da I would…")

    if word in ("will", "shall"):
        time = "future"
        state["i"] += 1
        take_extras()
        if peek() in MODALS:
            raise Unsupported("Modal fiilli cümleleri kurallar çeviremiyor.")
        if peek() == "have" and peek(1) == "been" and is_ing(peek(2)):
            aspect = "perfect-continuous"
            state["i"] += 2
            lemma = take_main(is_ing)
        elif peek() == "have" and is_v3(peek(1)):
            aspect = "perfect"
            state["i"] += 1
            lemma = take_main(is_v3)
        elif peek() == "be" and is_ing(peek(1)):
            aspect = "continuous"
            state["i"] += 1
            lemma = take_main(is_ing)
        elif peek() == "be" and is_v3(peek(1)) and "ADJ" not in word_lemmas(peek(1)):
            raise Unsupported("Edilgen (passive) cümleleri kurallar çeviremiyor.")
        else:
            lemma = take_main(is_base_verb)
    else:
        lemma = None
        if word in ("have", "has", "had", "'s"):
            saved = dict(state)
            state["i"] += 1
            take_extras()
            if peek() == "been" and is_ing(peek(1)):
                aspect = "perfect-continuous"
                state["i"] += 1
                lemma = take_main(is_ing)
            elif peek() == "been" and is_v3(peek(1)) and "ADJ" not in word_lemmas(peek(1)):
                raise Unsupported("Edilgen (passive) cümleleri kurallar çeviremiyor.")
            elif is_v3(peek()) and not (word == "'s" and "ADJ" in word_lemmas(peek())):
                aspect = "perfect"
                lemma = take_main(is_v3)
            elif word == "'s" or (word in ("have", "has", "had") and peek() in ("been",)):
                state.update(saved)   # she's happy → is; "has been" + sıfat → aşağıda be
            else:
                state.update(saved)   # I have a car → have asıl fiil
            if lemma:
                if word == "had":
                    time = "past"
                elif word in ("has", "'s"):
                    agr = "3sg"
                elif agr == "3sg":
                    agr = "pl"
        if lemma is None and word == "'s" or lemma is None and word in BE_FORMS:
            time = "past" if word in ("was", "were") else "present"
            if word in ("am", "'m"):
                agr = "1sg"
            elif word in ("is", "'s"):
                agr = "3sg"
            elif word in ("are", "'re"):
                agr = "pl"
            elif word == "was" and agr == "pl":
                agr = "3sg"
            elif word == "were" and agr == "3sg":
                agr = "pl"
            state["i"] += 1
            take_extras()
            following = peek()
            if following == "going" and peek(1) == "to":
                raise Unsupported("'be going to' kalıbını kurallar çeviremiyor; Gemini ile dene.")
            if following == "used" and peek(1) == "to":
                raise Unsupported("'be used to' kalıbını kurallar çeviremiyor.")
            if following == "being":
                raise Unsupported("'being' içeren cümleleri kurallar çeviremiyor.")
            if is_ing(following):
                aspect = "continuous"
                lemma = take_main(is_ing)
            elif is_v3(following) and "ADJ" not in word_lemmas(following):
                raise Unsupported("Edilgen (passive) cümleleri kurallar çeviremiyor.")
            else:
                lemma = "be"          # asıl fiil be: She is happy
        elif lemma is None and word in ("do", "does", "did") and (peek(1) == "not" or (is_base_verb(peek(1)) and "NOUN" not in word_lemmas(peek(1)))):
            time = "past" if word == "did" else "present"
            if word == "does":
                agr = "3sg"
            elif word == "do" and agr == "3sg":
                agr = "pl"
            state["i"] += 1
            take_extras()
            lemma = take_main(is_base_verb)
        elif lemma is None:
            surface = words[state["i"]] if state["i"] < len(words) else ""
            if not surface or not is_verb_word(surface):
                raise Unsupported("Cümlenin fiilini bulamadım.")
            lower = surface.lower()
            lemma = verb_lemma(lower)
            if lower != lemma and lower in forms_of(lemma, "VBZ"):
                agr = "3sg"
            elif lower != lemma and lower in forms_of(lemma, "VBD"):
                time = "past"
            elif lower == lemma:
                if agr == "3sg":
                    if lemma not in forms_of(lemma, "VBD"):
                        raise Unsupported("Özne ile fiil uyuşmuyor (he/she/it ile fiile -s gelir).")
                    time = "past"          # He put … (puts değil) → geçmiş
            elif lower.endswith("ing"):
                raise Unsupported("Fiil öbeği eksik görünüyor (ör. 'She working' yerine 'She is working').")
            else:
                raise Unsupported("Cümlenin fiilini bulamadım.")
            state["i"] += 1

    rest = words[state["i"]:]
    if lemma == "be" and rest and rest[0].lower() == "to":
        raise Unsupported("'been to' (bir yere gidip gelmiş olmak) ya da 'be to' kalıbını kurallar çeviremiyor.")
    check_rest(rest)
    return {
        "subject": subject, "agr": agr, "lemma": lemma, "adverb": state["adverb"], "rest": rest,
        "negative": state["negative"], "detected": f"{time}-{aspect}",
    }


def check_rest(rest):
    lower = [w.lower() for w in rest]
    for index, word in enumerate(lower):
        following = lower[index + 1] if index + 1 < len(lower) else ""
        clause = word == "that" and (following in PRONOUNS or following in DETERMINERS or following == "there")
        if word in SUBORDINATORS or clause:
            raise Unsupported(f"Yan cümleli ('{rest[index]}') cümleleri kurallar çeviremiyor.")
        if word in CONJUNCTIONS and index + 1 < len(lower):
            nxt = lower[index + 1]
            if nxt in PRONOUNS or nxt in MODALS or nxt in BE_FORMS or (is_verb_word(nxt) and "NOUN" not in word_lemmas(nxt) and "ADJ" not in word_lemmas(nxt)):
                raise Unsupported("İki fiilli (and/but ile bağlanmış) cümleleri kurallar çeviremiyor.")
        if word in MODALS or word in ("will", "won't"):
            raise Unsupported("Cümlede ikinci bir fiil öbeği var; kurallar yalnızca tek fiilli cümleyi çevirir.")
        if word in PRONOUNS and word not in ("it", "you") and index + 1 < len(lower) and is_verb_word(lower[index + 1]) and lower[index + 1] not in DETERMINERS:
            inflected = lower[index + 1]
            if inflected in BE_FORMS or inflected in ("has", "have", "had", "did", "does") or inflected != verb_lemma(inflected):
                raise Unsupported("Cümlede ikinci bir özne ve fiil var; kurallar yalnızca tek fiilli cümleyi çevirir.")


# ----- 4. Zamanları kurma -----

def be_form(time, agr):
    if time == "past":
        return "was" if agr in ("1sg", "3sg") else "were"
    return {"1sg": "am", "3sg": "is"}.get(agr, "are")


def split_suffix(form, lemma, kind):
    """Fiil biçimini gövde + ek parçalarına ayırır (renklendirme için)."""
    lower = form.lower()
    if kind == "ing" and lower.endswith("ing"):
        return [{"t": form[:-3], "r": "verb"}, {"t": form[-3:], "r": "suf"}]
    if kind == "s":
        if lower.endswith("es") and lower[:-2] in (lemma, lemma.rstrip("y")):
            return [{"t": form[:-2], "r": "verb"}, {"t": form[-2:], "r": "suf"}]
        if lower.endswith("ies") and lemma.endswith("y"):
            return [{"t": form[:-3], "r": "verb"}, {"t": form[-3:], "r": "suf"}]
        if lower.endswith("s") and lower[:-1] == lemma:
            return [{"t": form[:-1], "r": "verb"}, {"t": form[-1:], "r": "suf"}]
        return [{"t": form, "r": "irr"}]
    if kind == "ed":
        if lower.endswith("ed") and (lower.startswith(lemma[:-1]) if lemma.endswith("e") or lemma.endswith("y") else lower.startswith(lemma)):
            return [{"t": form[:-2], "r": "verb"}, {"t": form[-2:], "r": "suf"}]
        return [{"t": form, "r": "irr"}]
    return [{"t": form, "r": "verb"}]


def verb_form(lemma, tag, time="present", agr="3sg"):
    if lemma == "be":
        if tag == "VBD":
            return be_form("past", agr)
        if tag == "VBZ":
            return be_form("present", agr)
    if lemma == "have" and tag == "VBZ":
        return "has" if agr == "3sg" else "have"
    if tag == "VBZ" and agr != "3sg":
        return lemma
    forms = inflect(lemma, tag)
    if lemma == "be" and tag == "VBN":
        return "been"
    return forms[0] if forms else lemma


def lower_first(words):
    """Soru cümlesinde özne başa gelmediği için ilk harfi küçültülür (I ve özel adlar kalır)."""
    if not words:
        return words
    first = words[0]
    lower = first.lower()
    if lower == "i":
        return ["I"] + words[1:]
    if lower in PRONOUNS or lower in DETERMINERS:
        return [lower] + words[1:]
    # Çoğul cins isim (Children play → Do children play?); tekil büyük harfli kelime özel ad sayılır (Tom, Mark)
    nouns = word_lemmas(lower).get("NOUN")
    if not first.isupper() and nouns and (lower in PLURAL_ONLY or (lower not in nouns and lower.endswith("s"))):
        return [lower] + words[1:]
    return words


def build(parsed, key, polarity, phrases):
    time, aspect = key.split("-", 1)
    subject = list(parsed["subject"])
    agr = parsed["agr"]
    lemma = parsed["lemma"]
    adverb = parsed["adverb"]
    if adverb and polarity == "neg" and adverb.lower() == "never":
        adverb = "ever"
    rest = list(parsed["rest"])
    front = [p["text"] for p in phrases if p["front"] and key in p["fits"]]
    back = [p["text"] for p in phrases if not p["front"] and key in p["fits"]]

    # yardımcılar + fiil
    aux = []          # [(kelime, rol)]
    if time == "future":
        aux.append(("will", AUX_ROLE))
    if aspect in ("perfect", "perfect-continuous"):
        if time == "future":
            aux.append(("have", AUX_ROLE))
        elif time == "past":
            aux.append(("had", AUX_ROLE))
        else:
            aux.append(("has" if agr == "3sg" else "have", AUX_ROLE))
    if aspect == "perfect-continuous":
        aux.append(("been", AUX_ROLE))
    if aspect == "continuous":
        aux.append(("be" if time == "future" else be_form(time, agr), AUX_ROLE))

    if aspect in ("continuous", "perfect-continuous"):
        main = split_suffix(inflect(lemma, "VBG")[0] if inflect(lemma, "VBG") else lemma + "ing", lemma, "ing")
    elif aspect == "perfect":
        main = split_suffix(verb_form(lemma, "VBN"), lemma, "ed")
    elif time == "future":
        main = [{"t": lemma, "r": "verb"}]
    else:
        main = None   # simple present / past aşağıda

    if main is None:
        # present / past simple
        if lemma == "be":
            aux = [(be_form(time, agr), "verb")]
            main = []
        elif polarity == "pos":
            if time == "past":
                main = split_suffix(verb_form(lemma, "VBD", agr=agr), lemma, "ed")
            elif agr == "3sg":
                main = split_suffix(verb_form(lemma, "VBZ", agr=agr), lemma, "s")
            else:
                main = [{"t": lemma, "r": "verb"}]
        else:
            aux = [("did" if time == "past" else ("does" if agr == "3sg" else "do"), AUX_ROLE)]
            main = [{"t": lemma, "r": "verb"}]

    parts = []

    def add(text, role=""):
        parts.append({"t": text, "r": role})

    subject_words = lower_first(subject) if polarity == "q" or front else subject
    if polarity == "q":
        first_aux, first_role = aux[0]
        add(first_aux[:1].upper() + first_aux[1:], first_role)
        for w in subject_words:
            add(w)
        if adverb:
            add(adverb)
        for w, role in aux[1:]:
            add(w, role)
    else:
        for phrase in front:
            add(phrase[:1].upper() + phrase[1:])
        for index, w in enumerate(subject_words):
            add(w[:1].upper() + w[1:] if index == 0 and not front else w)
        if aux:
            add(aux[0][0], aux[0][1])
            if polarity == "neg":
                add("not", "neg")
            if adverb:
                add(adverb)
            for w, role in aux[1:]:
                add(w, role)
        elif adverb:
            add(adverb)
    for piece in main:
        parts.append(dict(piece))
    for w in rest:
        add(w)
    if polarity == "q":
        for phrase in front:
            add(phrase.lower())
    for phrase in back:
        add(phrase)
    add("?" if polarity == "q" else ".", "p")
    return {"text": join_parts(parts), "parts": parts}


def join_parts(parts):
    """Parçaları metne çevirir: kelimeler boşlukla; fiil gövdesi ile eki ve noktalama bitişik."""
    text = ""
    previous = None
    for part in parts:
        glue = previous is not None and (part["r"] == "p" or (previous["r"] == "verb" and part["r"] == "suf"))
        if text and not glue:
            text += " "
        text += part["t"]
        previous = part
    return text


def merge_parts(parts):
    """Bitişik yazılan parçaları kelime olarak gruplar: [[gövde, ek], [kelime], …] (arayüz kolay çizsin)."""
    words = []
    for part in parts:
        if words and (part["r"] == "p" or (words[-1][-1]["r"] == "verb" and part["r"] == "suf")):
            words[-1].append(part)
        else:
            words.append([part])
    return words


def row_note(key, lemma, phrases):
    notes = []
    aspect = key.split("-", 1)[1]
    natural = True
    if lemma in STATIVE and aspect in ("continuous", "perfect-continuous"):
        natural = False
        if lemma == "have":
            notes.append("‘have’ sahiplik anlamında durum fiilidir; continuous biçimi doğal değil (yemek, banyo gibi eylem anlamında kullanılır).")
        elif lemma == "be":
            notes.append("‘be’ continuous biçimde yalnızca geçici davranış anlatır (He is being rude); çoğu cümlede doğal değil.")
        else:
            notes.append(f"‘{lemma}’ durum fiilidir; continuous biçimde genellikle kullanılmaz.")
    dropped = [p["text"] for p in phrases if key not in p["fits"]]
    if dropped:
        notes.append(f"‘{', '.join(dropped)}’ bu zamanla uyuşmadığı için çıkarıldı.")
    return " ".join(notes), natural


def convert(sentence):
    """Kural tabanlı dönüştürme. Desteklenmeyen cümlede {"supported": False, "reason"} döner."""
    try:
        body = tokenize(str(sentence or ""))
        rest_body, phrases = pull_time_phrases(body)
        if not rest_body:
            raise Unsupported("Cümlede özne ve fiil yok.")
        parsed = parse(rest_body)
    except Unsupported as exc:
        return {"supported": False, "reason": str(exc), "source": "rules", "sentence": str(sentence or "").strip()}
    rows = []
    for key in TENSES:
        note, natural = row_note(key, parsed["lemma"], phrases)
        time, aspect = key.split("-", 1)
        row = {"key": key, "time": time, "aspect": aspect, "note": note, "natural": natural}
        for polarity in ("pos", "neg", "q"):
            row[polarity] = build(parsed, key, polarity, phrases)
        rows.append(row)
    notes = []
    if parsed["detected"] == "present-simple" and parsed["lemma"] in forms_of(parsed["lemma"], "VBD") and parsed["agr"] != "3sg":
        notes.append("Fiil (ör. put, cut) geçmişte de aynı yazıldığı için cümle geçmiş zaman da olabilir.")
    for phrase in phrases:
        if parsed["detected"] not in phrase["fits"]:
            notes.append(f"‘{phrase['text']}’ yazdığın zamanla zaten uyuşmuyor; bir kontrol et.")
    return {"supported": True, "source": "rules", "sentence": body + ".", "detected": parsed["detected"],
            "negative": parsed["negative"], "notes": notes, "rows": rows}


# ----- 5. Gemini yolu -----

AI_PROMPT = """You are an experienced English teacher for Turkish-speaking learners.
Rewrite the following English sentence in all twelve tenses of English, keeping its meaning, subject and
vocabulary as close as possible. Use the affirmative form if the sentence is affirmative and the negative form
if it is negative. If the sentence is a question, keep every version a question. Change only the main verb
phrase; adjust or drop time expressions that cannot be used with a tense, and say so in "note".

Sentence: "{sentence}"

Return JSON in exactly this shape:
{{"detected": "<the tense key of the original sentence or empty>",
  "tenses": [{{"key": "present-simple", "text": "<sentence>", "verb": "<the exact verb phrase as it appears in text>",
               "tr": "<natural Turkish translation>", "natural": true, "note": "<short Turkish note or empty>"}}]}}

Use exactly these twelve keys, each once, in this order: {keys}.
"natural": false when the version is grammatical but unusual (for example a stative verb in a continuous tense);
explain why in Turkish in "note". Notes and translations are in Turkish, sentences in English."""

ai_cache = None
ai_lock = threading.Lock()
CACHE_NAME = "tenses.json"


def cache():
    global ai_cache
    with ai_lock:
        if ai_cache is None:
            stored = storage.read(CACHE_NAME, {})
            ai_cache = stored if isinstance(stored, dict) else {}
        return ai_cache


def cache_key(sentence):
    return re.sub(r"\s+", " ", sentence.strip().lower())


def marked_parts(text, verb):
    """Gemini satırında fiil öbeğini işaretler: [{"t", "r"}] (öbek metinde yoksa hepsi düz)."""
    if verb:
        index = text.lower().find(verb.lower())
        if index >= 0:
            parts = []
            if text[:index].strip():
                parts.append({"t": text[:index].strip(), "r": ""})
            parts.append({"t": text[index:index + len(verb)], "r": AUX_ROLE})
            tail = text[index + len(verb):]
            if tail.strip():
                parts.append({"t": tail.strip(), "r": "p" if re.fullmatch(r"[.!?]+", tail.strip()) else ""})
            return parts
    return [{"t": text, "r": ""}]


def clean_ai(data):
    if not isinstance(data, dict) or not isinstance(data.get("tenses"), list):
        raise GeminiError("Gemini'nin yanıtı beklenen biçimde değil. Yeniden dene.", 502, "bad_json")
    found = {}
    for item in data["tenses"]:
        if not isinstance(item, dict):
            continue
        key = as_text(item.get("key"), 40)
        text = as_text(item.get("text"), 300)
        if key in TENSES and text and key not in found:
            verb = as_text(item.get("verb"), 80)
            time, aspect = key.split("-", 1)
            found[key] = {"key": key, "time": time, "aspect": aspect,
                          "pos": {"text": text, "parts": marked_parts(text, verb)},
                          "tr": as_text(item.get("tr"), 300), "note": as_text(item.get("note"), 300),
                          "natural": item.get("natural") is not False}
    if len(found) != len(TENSES):
        raise GeminiError("Gemini on iki zamanın hepsini vermedi. Yeniden dene.", 502, "bad_json")
    detected = as_text(data.get("detected"), 40)
    return [found[key] for key in TENSES], detected if detected in TENSES else ""


def convert_ai(sentence):
    text = re.sub(r"\s+", " ", str(sentence or "")).strip()
    if not text:
        raise GeminiError("Dönüştürülecek bir cümle yaz.", 400, "bad_request")
    if len(text) > MAX_LENGTH:
        raise GeminiError(f"Cümle çok uzun (en çok {MAX_LENGTH} karakter).", 400, "bad_request")
    if not re.search(r"[A-Za-z]", text):
        raise GeminiError("Cümlede İngilizce kelime yok.", 400, "bad_request")
    key = cache_key(text)
    saved = cache().get(key)
    if saved:
        return saved
    data, model = generate_json(AI_PROMPT.format(sentence=text.replace('"', "'"), keys=", ".join(TENSES)), 0.2)
    rows, detected = clean_ai(data)
    record = {"supported": True, "source": "gemini", "sentence": text, "detected": detected, "negative": False,
              "notes": [], "rows": rows, "model": model, "at": int(clock.time())}
    with ai_lock:
        ai_cache[key] = record
        storage.merge_write(CACHE_NAME, ai_cache)
    return record
