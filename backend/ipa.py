"""
Telaffuz: kelimelerin IPA yazımı ve heceleri (eng_to_ipa / CMU sözlüğü).
"""

import re

from eng_to_ipa import stress, syllables
from eng_to_ipa.transcribe import cmu_to_ipa, get_cmu

ipa_cache = {}  # kelime -> IPA


# ===== IPA =====

WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")


LEADING_STRESS = re.compile(r"^([^aeiouæɑɔəɛɪʊʌɝɚˈˌ]+)([ˈˌ])")
STRESSED_AH = re.compile(r"\bah([12])\b")

# eng_to_ipa vurgulu AH sesini de 'ə' yazıyor (running -> ˈrənɪŋ).
# Doğrusu 'ʌ' (ˈrʌnɪŋ). Bunun için geçici "ahx" sesini tanıtıp sonra ʌ ile değiştiriyoruz.
stress.phones["ahx"] = "vowel"
syllables.PHONES["ahx"] = "vowel"

# Artikeller cümle içinde hep zayıf okunur
IPA_OVERRIDES = {"the": "ðə", "a": "ə"}


def pick_variant(options):
    """CMU bir kelime için birden çok telaffuz verebilir:
    to -> 't uw1' (tam), 't ah0' (zayıf). Öğrenen için vurgulu (1) tam hali seç."""
    stressed = [o for o in options if "1" in o]
    chosen = (stressed or options)[0]
    if chosen.startswith("__IGNORE__"):
        return chosen
    return STRESSED_AH.sub(r"ahx\1", chosen)


def lookup_ipa(words):
    """Kelimeleri tek SQL sorgusunda CMU sözlüğünden çevirip önbelleğe yazar."""
    cmu = get_cmu(words)
    chosen = [[pick_variant(options)] for options in cmu]
    for word, ipa in zip(words, cmu_to_ipa(chosen, stress_marking="all")):
        ipa = ipa[0]
        if word in IPA_OVERRIDES:
            ipa_cache[word] = IPA_OVERRIDES[word]
        elif "*" in ipa:
            ipa_cache[word] = ""  # sözlükte yok (özel isim, argo...): telaffuz bilinmiyor
        else:
            ipa = ipa.replace("ahx", "ʌ")
            # 'mˈjuzɪk' -> 'ˈmjuzɪk': vurgu işareti ilk sesliden önceki ünsüzlerin başına
            ipa_cache[word] = LEADING_STRESS.sub(r"\2\1", ipa)


def prepare_ipa(tokens):
    """Yeni kelimeleri tek seferde çevirir (kelime kelime sorgudan ~100 kat hızlı)."""
    new_words = sorted({
        w.lower()
        for t in tokens
        for w in WORD.findall(t.replace("’", "'"))
    } - ipa_cache.keys())
    if new_words:
        lookup_ipa(new_words)


def word_to_ipa(word):
    key = word.lower()
    if key not in ipa_cache:
        lookup_ipa([key])
    return ipa_cache[key]


def token_to_ipa(token):
    """'well-known,' -> 'wɛl noʊn'  /  '1990' -> ''"""
    token = token.replace("’", "'")
    if token.startswith(("[", "(")) and token.endswith(("]", ")")):
        return ""  # [Music], (Applause) gibi etiketler okunmaz
    pieces = [word_to_ipa(w) for w in WORD.findall(token)]
    if not pieces or any(p == "" for p in pieces):
        return ""
    return " ".join(pieces)


# ===== Heceleme (kelimeyi sondan başa kurma alıştırması için) =====

ARPA_VOWELS = {
    "aa": "ɑ", "ae": "æ", "ao": "ɔ", "aw": "aʊ", "ay": "aɪ", "eh": "ɛ", "er": "ər", "ey": "eɪ",
    "ih": "ɪ", "iy": "i", "ow": "oʊ", "oy": "ɔɪ", "uh": "ʊ", "uw": "u",
}
ARPA_CONSONANTS = {
    "b": "b", "ch": "ʧ", "d": "d", "dh": "ð", "f": "f", "g": "g", "hh": "h", "jh": "ʤ", "k": "k", "l": "l",
    "m": "m", "n": "n", "ng": "ŋ", "p": "p", "r": "r", "s": "s", "sh": "ʃ", "t": "t", "th": "θ", "v": "v",
    "w": "w", "y": "j", "z": "z", "zh": "ʒ",
}
# Bir hecenin başında bulunabilen ünsüz kümeleri (İngilizce): "str" olur, "mf" olmaz
LEGAL_ONSETS = {tuple(c.split()) for c in (
    "p l", "p r", "b l", "b r", "t r", "d r", "k l", "k r", "g l", "g r", "f l", "f r", "th r", "sh r",
    "s p", "s t", "s k", "s m", "s n", "s l", "s w", "t w", "d w", "k w", "g w",
    "s p l", "s p r", "s t r", "s k r", "s k w",
)}


def legal_onset(cluster):
    if len(cluster) <= 1:
        return cluster != ["ng"]
    if len(cluster) == 2 and cluster[1] == "y":  # "k y" (cute), "m y" (music)
        return cluster[0] not in ("y", "w", "r", "ng")
    return tuple(cluster) in LEGAL_ONSETS


def syllabify(word):
    """'comfortable' -> [{"ipa": "kʌm", "stress": 1}, {"ipa": "fər", "stress": 0}, ...]. Sözlükte yoksa [].
    Ünlüler arasındaki ünsüzlerden, hece başı olabilecek en uzun küme sonraki heceye verilir."""
    options = get_cmu([word.lower()])[0]
    stressed = [o for o in options if "1" in o]
    chosen = (stressed or options)[0]  # IPA ile aynı telaffuz seçilsin (pick_variant)
    if chosen.startswith("__IGNORE__"):
        return []
    phones = chosen.split()
    vowels = [i for i, phone in enumerate(phones) if phone[-1].isdigit()]
    if not vowels:
        return []
    starts = [0]  # her hecenin başladığı ses
    for previous, current in zip(vowels, vowels[1:]):
        cluster = phones[previous + 1:current]
        split = next(k for k in range(len(cluster) + 1) if legal_onset(cluster[k:]))
        starts.append(previous + 1 + split)
    result = []
    for begin, end in zip(starts, starts[1:] + [len(phones)]):
        ipa = ""
        level = 0
        for phone in phones[begin:end]:
            if phone[-1].isdigit():
                level = int(phone[-1])
                base = phone[:-1]
                ipa += ("ʌ" if level else "ə") if base == "ah" else ARPA_VOWELS.get(base, "")
            else:
                ipa += ARPA_CONSONANTS.get(phone, "")
        result.append({"ipa": ipa, "stress": level})
    return result
