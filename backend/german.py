"""
Almanca dil paketi: telaffuz (IPA), heceleme, yalın hâl, seviye ve videodaki kelime listesi (21 Kasım 2026).

- Telaffuz Almanya standart Almancasına (Hochdeutsch) göre, kurallarla üretilir (kullanıcı seçimi: ek paket yok).
  Almanca yazımda ünlü uzunluğu ve vurgu her zaman yazıdan okunamaz; kurallar yaygın durumları kapsar:
  - Uzun ünlü: çift ünlü (Meer), ünlü + h (fahren), ie (Liebe), açık hece (Name), kelime sonunda tek ünsüzden önce
    (Tag); çekimli biçimde yalın hâle bakılır (sagt → sagen: a uzun).
  - Kısa ünlü: çift ünsüz, ck, tz, ss ve birden çok ünsüzden önce; SHORT_WORDS içindeki tek heceli kelimeler.
  - Vurgu ilk hecede; vurgusuz önekler (be-, ge-, ver-, zer-, ent-, emp-, er-, miss-) sonrakine geçirir;
    -ieren, -tion, -ität, -ei, -ie, -ist, -ent, -ant, -ell, -al gibi yabancı ekler vurguyu kendine çeker.
  - Vurgusuz e → ə, sondaki -er → ɐ, ünlüden sonra r → ɐ̯, sonda b d g → p t k, -ig → ɪç, ch → ç / x, st/sp başta → ʃt/ʃp.
  Gösterim geniş (fonemik) ve yaklaşıktır; bileşik kelimelerde (Fahrrad) ve bazı alıntılarda yanlış çıkabilir.
- Yalın hâl: simplemma (Häuser → Haus, ging → gehen). İsimler büyük harfle döner; isim olduğu buradan anlaşılır.
- Seviye: İspanyolcadaki gibi yalın hâlin sıklık sırasından tahmin edilir (wordfreq). Yaklaşıktır.
"""

import re
import threading

import simplemma
from wordfreq import top_n_list, word_frequency, zipf_frequency

LANG = "de"
WORD = re.compile(r"[A-Za-zÄÖÜäöüß]+")
TAGS = re.compile(r"[\[(][^\])]*[\])]")  # [Musik], (Applaus)

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
LEVEL_RANKS = [(600, "A1"), (1200, "A2"), (2500, "B1"), (5000, "B2"), (10000, "C1")]
BASIC_RANK = 300
FREQUENCY_POOL = 40000

# Görev kelimeleri: bağlamsız çeviride yanlış çıkıyor, anlam ve türleri elle yazıldı.
# Anahtar simplemma'nın verdiği yalın hâldir (die, das, den, dem, des → der; mich, mir → ich).
FUNCTION_WORDS = {
    "der": ("tanımlık", "belirli tanımlık (der, die, das); Türkçede karşılığı yok"),
    "ein": ("tanımlık", "bir"),
    "kein": ("tanımlık", "hiç; değil (isimle)"),
    "und": ("bağlaç", "ve"),
    "oder": ("bağlaç", "veya"),
    "aber": ("bağlaç", "ama"),
    "denn": ("bağlaç", "çünkü; (soruda) peki"),
    "dass": ("bağlaç", "ki, -dığını"),
    "weil": ("bağlaç", "çünkü"),
    "wenn": ("bağlaç", "eğer; -dığında"),
    "ob": ("bağlaç", "-ıp -madığını"),
    "als": ("bağlaç", "-dığında (geçmiş); -den (daha); olarak"),
    "wie": ("bağlaç", "nasıl; gibi"),
    "in": ("edat", "içinde, -de; içine"),
    "im": ("edat", "in + dem: içinde"),
    "ins": ("edat", "in + das: içine"),
    "an": ("edat", "-de (yanında, üstünde)"),
    "am": ("edat", "an + dem: -de"),
    "auf": ("edat", "üzerinde, üstüne"),
    "aus": ("edat", "-den (içinden)"),
    "bei": ("edat", "yanında, -de"),
    "beim": ("edat", "bei + dem: yanında; -ırken"),
    "mit": ("edat", "ile"),
    "nach": ("edat", "-den sonra; -e (yer)"),
    "von": ("edat", "-den; -in"),
    "vom": ("edat", "von + dem: -den"),
    "zu": ("edat", "-e; (mastarla) -mek"),
    "zum": ("edat", "zu + dem: -e"),
    "zur": ("edat", "zu + der: -e"),
    "für": ("edat", "için"),
    "über": ("edat", "üzerinde; hakkında"),
    "unter": ("edat", "altında; arasında"),
    "vor": ("edat", "önünde; önce"),
    "durch": ("edat", "içinden; sayesinde"),
    "gegen": ("edat", "karşı"),
    "ohne": ("edat", "-sız, olmadan"),
    "um": ("edat", "etrafında; saat …'de"),
    "bis": ("edat", "-e kadar"),
    "seit": ("edat", "-den beri"),
    "ich": ("zamir", "ben"),
    "du": ("zamir", "sen"),
    "er": ("zamir", "o (eril)"),
    "sie": ("zamir", "o (dişil); onlar; Sie: siz (nezaket)"),
    "es": ("zamir", "o (nötr)"),
    "wir": ("zamir", "biz"),
    "ihr": ("zamir", "siz; onun (dişil), onların"),
    "man": ("zamir", "insan, kişi (genel özne)"),
    "sich": ("zamir", "kendini, kendine"),
    "mein": ("zamir", "benim"),
    "dein": ("zamir", "senin"),
    "unser": ("zamir", "bizim"),
    "euer": ("zamir", "sizin"),
    "dieser": ("belirteç", "bu"),
    "was": ("zamir", "ne"),
    "wer": ("zamir", "kim"),
    "wo": ("zarf", "nerede"),
    "nicht": ("zarf", "değil"),
    "ja": ("zarf", "evet"),
    "nein": ("zarf", "hayır"),
}

# ===== Sıklık sırası ve seviye =====

rank_lock = threading.Lock()
lemma_rank = None   # küçük harfli yalın hâl -> sıra (0 en sık)
verb_lemmas = set()  # sıklık listesinde çekimli biçimi görülen mastarlar (verb_set; tür tahmini için)
verb_lock = threading.Lock()
lemma_cache = {}
VERB_FORM_ENDINGS = ("t", "st", "te", "ten", "tet", "test")


def fold(word):
    """Sıklık anahtarı: küçük harf, ß → ss (wordfreq kelimeleri böyle saklar: straße → strasse)."""
    return word.lower().replace("ß", "ss")


# wordfreq'ten gelen ss'li kelimede ß'yi geri koymak için (Pekiştir adayları): çift ünlüden sonra her zaman ß
# (weiss → weiß, ausserdem → außerdem); uzun tek ünlüden sonra tahmin edilemez, sık kelimeler elle yazıldı.
ESZETT_STEMS = ("gross", "gröss", "strass", "spass", "fuss", "füss", "süss", "gruss", "grüss", "stoss", "stöss",
                "bloss", "sosse", "spiess", "kloss", "klöss", "gemäss")


def restore_eszett(word):
    if "ss" not in word:
        return word
    # ss'den sonra ünlü ya da kelime sonu gelmeli; baştaki aus- öneki değişmez (Ausstellung, aussehen)
    word = re.sub(r"(ei|ie|au|eu|äu)ss(?=[aeiouäöü]|$)",
                  lambda m: m.group() if m.start() == 0 and m.group(1) in ("au", "äu") else m.group(1) + "ß", word)
    if word.startswith(("ausser", "äusser")):
        word = word[:2] + "ß" + word[4:]                # außer, äußern
    for stem in ESZETT_STEMS:
        word = word.replace(stem, stem.replace("ss", "ß"))
    return word


def verb_set():
    """Sıklık listesinde çekimli biçimi görülen mastarlar (geht, spricht, atmet → gehen, sprechen, atmen).
    simplemma küçük harfli mastarları bazen isme çevirir (sprechen → Spreche, sagen → Sage); fiil olduğu buradan anlaşılır."""
    with verb_lock:
        if not verb_lemmas:
            for word in top_n_list(LANG, FREQUENCY_POOL):
                if WORD.fullmatch(word) and word.endswith(VERB_FORM_ENDINGS):
                    lemma = simplemma.lemmatize(word, lang=LANG)
                    if lemma != word and lemma[:1].islower() and lemma.endswith(("en", "ern", "eln")):
                        verb_lemmas.add(lemma)
    return verb_lemmas


def modern_spelling(lemma, word):
    """simplemma bazı yalın hâlleri eski yazımla verir (Flüsse → Fluß): kelime ss ile yazılmışsa ss korunur."""
    if lemma.endswith("ß") and word.lower()[len(lemma) - 1:len(lemma) + 1] == "ss":  # Flüsse (Ausstoß değil)
        return lemma[:-1] + "ss"
    return lemma


def lower_lemma(word):
    """Küçük harfle yazılmış biçimin yalın hâli (sıklık listesi küçük harflidir; fiil ve sıfatlar metinde de küçüktür).
    simplemma küçük harfli isimleri yanlış çözebilir (tisch → tischen, arbeit → abarbeiten): büyük harfli biçim
    bir isme iniyorsa ve kelime fiil çekimine benzemiyorsa isim seçilir."""
    verbs = verb_set()
    if word in verbs:
        return word                                  # sprechen, atmen (Spreche, Atmen değil)
    if word.startswith("ge") and word.endswith("en") and word[2:] in verbs:
        return word[2:]                              # gefahren → fahren, gesehen → sehen
    if word.endswith("e") and word + "n" in verbs:
        return word + "n"                            # glaube → glauben, sage → sagen (Glaube, Sage değil)
    low = simplemma.lemmatize(word, lang=LANG)
    if low[:1].isupper():
        return low                                   # häuser → Haus
    if low != word and low.startswith(word) and low not in verbs:
        return word.capitalize()                     # tisch → tischen, gabel → gabeln değil: isim (Tisch, Gabel)
    if low != word and word.startswith(low):
        return low                                   # schönen → schön, guten → gut
    cap = simplemma.lemmatize(word.capitalize(), lang=LANG)
    if low in verbs:
        if cap == word.capitalize() and zipf_frequency(word, LANG) > zipf_frequency(low, LANG):
            return cap                               # arbeit → Arbeit (abarbeiten değil)
        return low                                   # macht → machen, kam → kommen, las → lesen
    if cap[:1].isupper() and low != word:
        return cap
    return low                                       # morgen, essen, orten: küçük harf kalır


def lemma_of(word):
    """Yalın hâl, simplemma'nın yazımıyla: isimler büyük harfle (Häuser → Haus), diğerleri küçük (ging → gehen).
    Önbellek yazıma duyarlıdır: metindeki "Tisch" ile sıklık listesindeki "tisch" ayrı çözülür."""
    if word not in lemma_cache:
        if word == word.lower():
            lemma = lower_lemma(word)
        else:
            lemma = simplemma.lemmatize(word, lang=LANG)
            if lemma.lower() == word.lower() and not lemma[:1].isupper():
                lemma = lower_lemma(word.lower())
            elif lemma[:1].islower() and lemma.startswith(word.lower()):
                lemma = word                         # Gabel → gabeln, Leder → ledern değil: isim kendisi kalır
        lemma = modern_spelling(lemma, word)
        lemma_cache[word] = lemma if lemma[:1].isupper() else lemma.lower()
    return lemma_cache[word]


# Sıfat ekleri: küçük harfli kelime bunlarla bitiyorsa büyük harfli (adlaşmış) biçime çevrilmez (elegant, online, beste)
ADJECTIVE_ENDINGS = ("ant", "ent", "ig", "lich", "isch", "bar", "sam", "los", "haft", "iv", "al", "ell", "ös", "är",
                     "ine", "ste", "ick", "ck")


def headword(key):
    """Küçük harfli sıklık listesi kelimesinin sözlük biçimi (Pekiştir adayları): isimse büyük harfle (nacht → Nacht).
    Kelime kendi yalın hâli değilse (Häuser, ging) None."""
    word = restore_eszett(key)
    lemma = lemma_of(word)
    if fold(lemma) != key:
        return None
    if lemma[:1].islower() and word not in FUNCTION_WORDS:
        ranks()
        if (word not in verb_set() and not word.endswith(ADJECTIVE_ENDINGS)
                and simplemma.lemmatize(word.capitalize(), lang=LANG) == word.capitalize()):
            return word.capitalize()                 # nacht → Nacht (fiil çekimi görülmediyse)
    return lemma


def ranks():
    global lemma_rank
    with rank_lock:
        if lemma_rank is None:
            totals = {}
            for word in top_n_list(LANG, FREQUENCY_POOL):
                if WORD.fullmatch(word):
                    lemma = lemma_of(restore_eszett(word))  # strasse → straße → Straße (simplemma ss'li yazımı tanımaz)
                    key = fold(lemma)
                    totals[key] = totals.get(key, 0) + word_frequency(word, LANG)
            ordered = sorted(totals.items(), key=lambda item: -item[1])
            lemma_rank = {lemma: index for index, (lemma, _) in enumerate(ordered)}
    return lemma_rank


def level_of(lemma):
    rank = ranks().get(fold(lemma))
    if rank is None:
        return "C2"
    return next((level for limit, level in LEVEL_RANKS if rank < limit), "C2")


def is_known(word):
    return simplemma.is_known(word, lang=LANG) or simplemma.is_known(word.lower(), lang=LANG) or fold(lemma_of(word)) in ranks()


def is_basic(lemma):
    return lemma.lower() in FUNCTION_WORDS or ranks().get(fold(lemma), 10 ** 9) < BASIC_RANK


def is_noun(lemma):
    return lemma[:1].isupper()


def pos_of(word, lemma):
    """Kaba tür tahmini: büyük harfli yalın hâl isim, çekimli biçimi görülen -en mastarı fiil."""
    key = lemma.lower()
    if key in FUNCTION_WORDS:
        return FUNCTION_WORDS[key][0]
    if is_noun(lemma):
        return "isim"
    if key in verb_set():
        return "fiil"
    return ""


# ===== Telaffuz (Hochdeutsch) =====

VOWEL_LETTERS = set("aeiouäöüy")
LONG_VOWEL = {"a": "aː", "e": "eː", "i": "iː", "o": "oː", "u": "uː", "ä": "ɛː", "ö": "øː", "ü": "yː", "y": "yː"}
SHORT_VOWEL = {"a": "a", "e": "ɛ", "i": "ɪ", "o": "ɔ", "u": "ʊ", "ä": "ɛ", "ö": "œ", "ü": "ʏ", "y": "ʏ"}
UNSTRESSED_VOWEL = {"a": "a", "e": "e", "i": "i", "o": "o", "u": "u", "ä": "ɛ", "ö": "ø", "ü": "y", "y": "y"}
DIPHTHONGS = {"ei": "aɪ̯", "ai": "aɪ̯", "ey": "aɪ̯", "ay": "aɪ̯", "eu": "ɔʏ̯", "äu": "ɔʏ̯", "au": "aʊ̯"}
FRONT = set("eiäöüy")
# Tek heceli, kısa ünlülü kelimeler (sonda tek ünsüz kuralı uzun derdi)
SHORT_WORDS = {"an", "in", "im", "um", "am", "ab", "ob", "es", "das", "was", "des", "man", "hat", "mit", "bis", "von",
               "vom", "weg", "zum", "ins", "ich", "mich", "dich", "sich", "ist", "bin", "hin", "dran", "drin", "plus",
               "bus", "fit", "top", "job", "chef", "kann", "will", "soll", "muss", "darf", "doch", "un"}
# ch'den önce uzun ünlülü kelimeler (genel kural: ch'den önce kısa; lachen, kochen, Woche)
LONG_BEFORE_CH = {"nach", "hoch", "buch", "tuch", "fluch", "besuch", "versuch", "kuchen", "suchen", "besuchen",
                  "versuchen", "fluchen", "bücher", "sprache", "gespräch", "brache"}
# Cümlede vurgusuz okunan tek heceli görev kelimeleri: vurgu işareti konmaz
UNSTRESSED_MONO = {"der", "die", "das", "den", "dem", "des", "ein", "zu", "und", "in", "im", "an", "am", "es", "er", "sie",
                   "wir", "ihr", "mit", "von", "vom", "zum", "zur", "auf", "aus", "bei", "für", "ich", "du", "man", "sich",
                   "ist", "hat", "so", "wie", "als", "ob", "um", "dass", "was", "wo", "noch", "schon", "nur", "doch"}
UNSTRESSED_PREFIXES = ("zer", "ver", "ent", "emp", "miss", "be", "ge", "er")
# Önek gibi görünüp önek olmayanlar (ilk heceden vurgulu)
NOT_PREFIXED = {"geben", "gegen", "gestern", "beide", "besser", "beste", "beten", "besen", "erde", "ernte", "ernst",
                "erste", "erst", "gelb", "gelten", "genug", "gerade", "geld", "gern", "gerne", "geist", "gehen", "erben",
                "verse", "bergen", "berlin", "becher", "beere", "gestalt", "eben", "ende", "berg", "beruf"}
# Vurguyu çeken sonlar (ilk eşleşen); değer: vurgulu hece sondan kaçıncı (1 = son hece)
STRESSED_ENDINGS = [("ieren", 2), ("ierte", 2), ("ierten", 2), ("iert", 1), ("tion", 1), ("sion", 1), ("ität", 1),
                    ("erei", 1), ("ei", 1), ("isten", 2), ("ist", 1), ("enten", 2), ("ent", 1), ("anten", 2), ("ant", 1),
                    ("elle", 2), ("ell", 1), ("al", 1), ("ur", 1), ("ik", 1), ("ös", 1), ("ett", 1), ("enz", 1),
                    ("anz", 1), ("ie", 1), ("eur", 1), ("ismus", 2)]
NO_ENDING_STRESS = {"abend", "jugend", "tugend", "elend", "kunst", "papst", "familie", "linie", "lilie", "technik",
                    "physik", "republik", "mittag", "ostern", "arbeit", "freiheit", "ferien", "ende", "wende", "monat",
                    "heimat", "zukunft", "spital", "anzahl", "liebe", "ernst", "dienst", "kunde", "stunde", "biene",
                    "eltern", "ausland", "inland", "kaiser", "zweifel"}
STRESS_OVERRIDES = {"vielleicht": 1, "warum": 1, "woher": 1, "wohin": 1, "zurück": 1, "allein": 1, "sofort": 1,
                    "hinaus": 1, "heraus": 1, "herein": 1, "hinein": 1, "darum": 1, "voraus": 1, "vorbei": 1,
                    "jedoch": 1, "lebendig": 1, "polizei": 2, "familie": 1, "polizist": 2, "mathematik": 3,
                    "elefant": 2, "kaffee": 0, "hotel": 1, "büro": 1, "foto": 0, "auto": 0, "kino": 0, "radio": 0,
                    "sofa": 0, "museum": 1, "computer": 1, "november": 1, "dezember": 1, "september": 1, "oktober": 1,
                    "ergebnis": 1, "erinnerung": 1, "erinnern": 1, "erlebnis": 1, "januar": 0, "februar": 0, "august": 1, "april": 1, "juli": 0, "juni": 0, "klavier": 1}
ONSETS = {"pl", "pr", "bl", "br", "tr", "dr", "kl", "kr", "gl", "gr", "fl", "fr", "ʃt", "ʃp", "ʃl", "ʃm", "ʃn", "ʃv",
          "kv", "ts", "pf", "ʃr", "pʁ", "bʁ", "tʁ", "dʁ", "kʁ", "gʁ", "fʁ", "ʃʁ"}
SPLIT_CLUSTERS = ("sp", "st", "sc", "pr", "tr", "kl", "fr", "gr", "br", "dr", "zw", "ch", "kr", "pl", "bl", "fl", "gl")


def prefix_end(word):
    """Vurgusuz önekin bittiği harf konumu (besuchen → 2, verstehen → 3); önek yoksa 0."""
    if word in NOT_PREFIXED or len(word) < 5:
        return 0
    for prefix in UNSTRESSED_PREFIXES:
        rest = word[len(prefix):]
        if not word.startswith(prefix) or len(rest) < 3 or not any(ch in VOWEL_LETTERS for ch in rest):
            continue
        if prefix == "er" and rest[0] in VOWEL_LETTERS:
            return 0  # Erinnerung: önek değil
        if (simplemma.is_known(rest, lang=LANG) or simplemma.is_known(rest.capitalize(), lang=LANG)
                or simplemma.is_known(rest + "en", lang=LANG) or simplemma.is_known(rest[:-1] + "en", lang=LANG)
                or rest[:2] in SPLIT_CLUSTERS):
            return len(prefix)
    return 0


def graphemes(word, morpheme_start=0):
    """Kelimeyi ses birimlerine ayırır: (tür, değer, ipucu, harf konumu).
    Ünlü: ("V", harf, "long" | "diph" | "", konum); "long" = çift ünlü, ie, ünlü + h; "diph" = ei, au, eu…
    Ünsüz: ("C", ipa, "double" | "", konum); "double" önceki ünlüyü kısa yapar (ck, tz, ss, çift ünsüz…)."""
    out = []
    i = 0
    n = len(word)
    while i < n:
        rest = word[i:]
        ch = word[i]
        nxt = word[i + 1] if i + 1 < n else ""
        start_of_morpheme = i == 0 or i == morpheme_start
        if ch in VOWEL_LETTERS:
            pair = word[i:i + 2]
            if pair in DIPHTHONGS:
                out.append(("V", DIPHTHONGS[pair], "diph", i))
                i += 2
            elif pair == "ie":
                out.append(("V", "i", "long", i))
                i += 2
            elif nxt == ch and ch in "aeo":
                out.append(("V", ch, "long", i))
                i += 2
            elif nxt == "h":
                out.append(("V", ch, "long", i))  # ünlü + h: h okunmaz, ünlü uzun (fahren, Kuh, gehen)
                i += 2
            else:
                out.append(("V", ch, "", i))
                i += 1
            continue
        if rest.startswith(("tion", "sion")):
            out += [("C", "ts" if ch == "t" else "z", "", i), ("C", "j", "", i + 1)]
            i += 2
            continue
        for grapheme, ipa, hint in (("tsch", "tʃ", "double"), ("sch", "ʃ", ""), ("chs", "ks", "double"), ("ch", "CH", ""),
                                    ("ck", "k", "double"), ("tz", "ts", "double"), ("dt", "t", "double"),
                                    ("pf", "pf", ""), ("ph", "f", ""), ("qu", "kv", ""), ("ng", "ŋ", "double"),
                                    ("th", "t", ""), ("ss", "s", "double")):
            if rest.startswith(grapheme) and not (morpheme_start and i < morpheme_start < i + len(grapheme)):
                out.append(("C", ipa, hint, i))
                i += len(grapheme)
                break
        else:
            if ch == "n" and nxt == "k":
                out.append(("C", "ŋ", "", i))
            elif ch == "ß":
                out.append(("C", "s", "", i))
            elif nxt == ch and ch in "bdfgklmnprt":
                out.append(("C", ch, "double", i))
                i += 1
            elif ch == "s":
                if start_of_morpheme and nxt in ("t", "p"):
                    out.append(("C", "ʃ", "", i))
                elif nxt in VOWEL_LETTERS and (start_of_morpheme or word[i - 1] in VOWEL_LETTERS or word[i - 1] in "lnrmh"):
                    out.append(("C", "z", "", i))
                else:
                    out.append(("C", "s", "", i))
            elif ch == "z":
                out.append(("C", "ts", "", i))
            elif ch == "v":
                between = 0 < i < n - 1 and word[i - 1] in VOWEL_LETTERS and nxt in VOWEL_LETTERS
                out.append(("C", "v" if between else "f", "", i))
            elif ch == "w":
                out.append(("C", "v", "", i))
            elif ch == "x":
                out.append(("C", "ks", "double", i))
            elif ch == "c":
                out.append(("C", "ts" if nxt in FRONT else "k", "", i))
            elif ch in "bdfghjklmnprt":
                out.append(("C", ch, "", i))
            else:
                return []  # Almancada olmayan harf
            i += 1
    return out


def vowel_is_long(units, k, word, lemma):
    """units[k] ünlüsünün uzun okunup okunmadığı."""
    hint = units[k][2]
    if hint in ("long", "diph"):
        return hint == "long"
    after = []
    j = k + 1
    while j < len(units) and units[j][0] == "C":
        after.append(units[j])
        j += 1
    at_end = j >= len(units)
    if not after:
        return True  # açık hece ya da sonda ünlü (da, so, Kino)
    if after[0][2] == "double":
        return False
    if after[0][1] == "CH":
        return word in LONG_BEFORE_CH or (lemma or "") in LONG_BEFORE_CH
    if len(after) == 1:
        if not at_end:
            return True  # tek ünsüz + ünlü: açık hece (Name, Tage)
        return word not in SHORT_WORDS and after[0][1] != "ʃ"  # sonda tek ünsüz: Tag, gut (Tisch kısa)
    # iki ve daha çok ünsüz: genelde kısa; çekimli biçimde yalın hâlde açık hece varsa uzun (sagt ← sagen, Tags ← Tag)
    offset = units[k][3]
    if lemma and lemma != word and lemma[:offset + 1] == word[:offset + 1]:
        lemma_units = graphemes(lemma, prefix_end(lemma))
        same = next((m for m, unit in enumerate(lemma_units) if unit[0] == "V" and unit[3] == offset), None)
        if same is not None:
            return vowel_is_long(lemma_units, same, lemma, None)
    return False


def stressed_index(word, groups, units, boundary):
    """Vurgulu hecenin sırası (0'dan)."""
    count = len(groups)
    if count == 1:
        return 0
    if word in STRESS_OVERRIDES:
        return min(STRESS_OVERRIDES[word], count - 1)
    if word not in NO_ENDING_STRESS:
        for ending, from_end in STRESSED_ENDINGS:
            if word.endswith(ending) and count >= from_end + 1 and len(word) > len(ending) + 2:
                return count - from_end
    if boundary:
        return next((g for g, group in enumerate(groups) if units[group[0]][3] >= boundary), 0)
    return 0


def syllables(word):
    """'Fenster' -> [{"ipa": "fɛns", "stress": 1}, {"ipa": "tɐ", "stress": 0}]. Çözülemezse []."""
    original = word
    word = word.lower()
    boundary = prefix_end(word)
    units = graphemes(word, boundary)
    if not units:
        return []
    nuclei = [k for k, unit in enumerate(units) if unit[0] == "V"]
    if not nuclei:
        return []
    lemma = lemma_of(original).lower()

    # Hecelere böl: iki ünlü arasındaki ünsüzlerden sondaki (ya da geçerli ikili başlangıç) sonraki heceye geçer;
    # önek sınırı her zaman hece sınırıdır (ver-stehen, be-suchen)
    starts = [0]
    for previous, current in zip(nuclei, nuclei[1:]):
        between = list(range(previous + 1, current))
        at_boundary = [k for k in between + [current] if boundary and units[k][3] >= boundary
                       and units[previous][3] < boundary]
        if at_boundary:
            split = at_boundary[0]
        elif not between:
            split = current
        elif len(between) >= 2 and units[between[-1]][1] == "j":
            split = between[-2]  # -tion: Sta-tion (ʃta-ˈtsjoːn)
        elif len(between) >= 3 and units[between[-2]][1] + units[between[-1]][1] in ONSETS:
            split = between[-2]
        else:
            split = between[-1]
        starts.append(split)
    groups = [list(range(begin, end)) for begin, end in zip(starts, starts[1:] + [len(units)])]

    count = len(groups)
    stressed = stressed_index(word, groups, units, boundary)
    if count == 1 and word in UNSTRESSED_MONO:
        stressed = None

    pieces = []
    previous_vowel = ""
    for g, group in enumerate(groups):
        ipa = ""
        is_last = g == count - 1
        vowel_at = next((k for k in group if units[k][0] == "V"), None)
        coda = "".join(units[k][1] for k in group if vowel_at is not None and k > vowel_at)
        for k in group:
            kind, value, hint, offset = units[k]
            if kind == "V":
                previous_vowel = value
                if hint == "diph":
                    ipa += value
                    continue
                long = vowel_is_long(units, k, word, lemma)
                if g == stressed or count == 1:  # tek heceli vurgusuz kelimede de ünlü niteliği korunur (der: deːɐ̯)
                    sound = LONG_VOWEL[value] if long else SHORT_VOWEL[value]
                elif value == "e" and hint != "long":
                    if g == 0 and boundary:
                        sound = "ə" if word[:boundary] in ("be", "ge") else "ɛ"  # be-, ge- / ver-, zer-, er-
                    elif is_last and coda in ("r", "rn", "rs", "rt"):
                        sound = "ɐ"  # Fenster, Kinder, Eltern
                    elif is_last or (g > 0 and coda in ("", "n", "l", "m", "s", "t")):
                        sound = "ə"  # -e, -en, -el, -es, -et; Bä-cke-rei
                    else:
                        sound = "ɛ"
                else:
                    sound = UNSTRESSED_VOWEL[value] if long else SHORT_VOWEL[value]
                ipa += sound
                continue
            nxt = units[k + 1] if k + 1 < len(units) else None
            last = nxt is None
            before_consonant = nxt is not None and nxt[0] == "C"
            if value == "CH":
                back = k > 0 and units[k - 1][0] == "V" and units[k - 1][1] in ("a", "o", "u", "aʊ̯")
                value = "x" if back else "ç"
            elif value == "r":
                if ipa.endswith("ɐ"):
                    continue  # -er sonu
                if (last or before_consonant) and k > 0 and units[k - 1][0] == "V":
                    long_before = units[k - 1][2] != "diph" and vowel_is_long(units, k - 1, word, lemma)
                    value = "ɐ̯" if long_before else "ʁ"
                else:
                    value = "ʁ"
            elif value in ("b", "d", "g") and (last or (before_consonant and nxt[1] not in ("l", "r", "j"))):
                if (value == "g" and k > 0 and units[k - 1][0] == "V" and units[k - 1][1] == "i"
                        and (last or nxt[1] in ("t", "s"))):
                    value = "ç"  # -ig → ɪç (wichtig, König)
                else:
                    value = {"b": "p", "d": "t", "g": "k"}[value]
            if value == "g":
                value = "ɡ"
            ipa += value
        pieces.append(ipa)
    return [{"ipa": piece, "stress": 1 if k == stressed else 0} for k, piece in enumerate(pieces)]


syllabify = syllables

ipa_cache = {}


def word_to_ipa(word):
    """'Fenster' -> 'ˈfɛnstɐ'. Sözlükte olmayan kelime (özel ad, yabancı kelime) → ''."""
    key = word.lower()
    if key not in ipa_cache:
        parts = syllables(word) if is_known(word) else []
        ipa_cache[key] = "".join(("ˈ" if part["stress"] else "") + part["ipa"] for part in parts)
    return ipa_cache[key]


def token_to_ipa(token):
    """'Fenster,' -> 'ˈfɛnstɐ'  /  '[Musik]' -> ''  /  '1990' -> ''"""
    if token.startswith(("[", "(")) and token.endswith(("]", ")")):
        return ""
    pieces = [word_to_ipa(w) for w in WORD.findall(token)]
    if not pieces or any(p == "" for p in pieces):
        return ""
    return " ".join(pieces)


def prepare_ipa(tokens):
    ranks()


# ===== Videodaki kelimeler =====

def word_forms(word, texts):
    """Kayıtlı metinlerde aynı yalın hâle inen bütün biçimler (gehen → geht, ging, gegangen…), küçük harfle."""
    target = lemma_of(word).lower()
    forms = {word.lower(), target}
    for text in texts:
        for token in WORD.findall(text):
            low = token.lower()
            if low not in forms and lemma_of(token).lower() == target:
                forms.add(low)
    return forms


def translation_query(lemma):
    """Çeviri sorgusu: mastar tek başına emir gibi çevrilir (wohnen → "canlı", sprechen → "konuş");
    "zu" ile Türkçe mastar gelir (zu wohnen → yaşamak)."""
    return f"zu {lemma}" if lemma in verb_set() else lemma


def turkish_lower_first(text):
    """Google çevirisi Almanca isimlerin anlamını büyük harfle başlatır (Bina); kısaltma değilse küçült."""
    if len(text) < 2 or not text[1:2].islower():
        return text
    first = {"I": "ı", "İ": "i"}.get(text[0], text[0].lower())
    return first + text[1:]


def build_vocab(lines, translate_all, translations):
    """İngilizce vocab.build_vocab ile aynı biçim: {"levels", "phrasal": [], "basic", "translationError"}.
    İsimler büyük harfle yazılır (Haus). Özel ad sezgisi: Türkçesi kelimenin kendisi olan isimler (Berlin, Müller) atılır."""
    words = {}
    texts = [TAGS.sub(" ", line["text"]) for line in lines]
    written_lower = {raw for text in texts for raw in WORD.findall(text) if raw[:1].islower()}
    verbs = verb_set()
    for line, text in zip(lines, texts):
        for match in WORD.finditer(text):
            raw = match.group()
            token = raw.lower()
            lemma = lemma_of(raw)
            before = text[:match.start()].rstrip()
            if raw[:1].isupper() and (not before or before[-1] in ".!?:…"):
                # Cümle başındaki büyük harf isim demek değildir (Guck mal, Weiß ich nicht): küçük harfli çözüm
                # fiil, görev kelimesi ya da metinde küçük harfle de geçen bir kelimeyse o seçilir
                low_lemma = lemma_of(token)
                if low_lemma[:1].islower() and (low_lemma in verbs or low_lemma in FUNCTION_WORDS or token in written_lower):
                    lemma = low_lemma
            if (len(token) == 1 and lemma.lower() not in FUNCTION_WORDS) or not is_known(raw):
                continue
            entry = words.setdefault(lemma, {"word": lemma, "count": 0, "start": line["start"], "forms": set()})
            entry["count"] += 1
            entry["forms"].add(token)

    # Almanca konuşmada geçen İngilizce kelimeler (Challenge, Livestream) listeye alınmaz
    kept = [e for e in words.values() if e["word"].lower() in FUNCTION_WORDS
            or zipf_frequency(e["word"], "en") <= zipf_frequency(e["word"], LANG) + 1]
    error = translate_all([translation_query(e["word"]) for e in kept if e["word"].lower() not in FUNCTION_WORDS])

    levels = {level: [] for level in LEVELS}
    basic = []
    for entry in kept:
        lemma = entry["word"]
        key = lemma.lower()
        level = level_of(lemma)
        if key in FUNCTION_WORDS:
            meaning = FUNCTION_WORDS[key][1]
        else:
            meaning = turkish_lower_first(translations.get(translation_query(lemma), ""))
            if fold(meaning) == fold(key):  # çevrilmeden aynen dönen: isimse büyük olasılıkla özel ad
                if is_noun(lemma) and not error:
                    continue
                meaning = ""
        target = basic if is_basic(lemma) else levels[level]
        target.append({
            "word": lemma,
            "pos": pos_of(min(entry["forms"]), lemma),
            "ipa": word_to_ipa(lemma),
            "tr": meaning,
            "count": entry["count"],
            "start": entry["start"],
            "forms": sorted(entry["forms"]),
            "level": level,
        })
    for items in [*levels.values(), basic]:
        items.sort(key=lambda item: (-item["count"], item["word"].lower()))
    return {"levels": levels, "phrasal": [], "basic": basic, "translationError": error}
