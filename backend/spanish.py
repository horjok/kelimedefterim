"""
İspanyolca dil paketi: telaffuz (IPA), heceleme, yalın hâl, seviye ve videodaki kelime listesi.

- Telaffuz İspanya aksanına göre (kullanıcı seçimi, 20 Kasım 2026): c/z → θ (cielo /ˈθjelo/), ll ve y → ʝ (yeísmo).
  İspanyolcanın yazımı sese çok düzenli bağlı olduğu için IPA kurallarla üretilir, sözlük gerekmez.
  Gösterim geniş (fonemik): /b d g/ ünlü arasında da /b d g/ yazılır (öğrenene sade gelsin).
- Yalın hâl: simplemma (hablo, hablaste → hablar; casas → casa).
- Seviye: İspanyolca için cefrpy gibi açık bir CEFR sözlüğü yok. Seviye, yalın hâlin sıklık sırasından tahmin edilir
  (wordfreq; aynı yalın hâle inen biçimlerin sıklıkları toplanır). Sınırlar yaygın "seviye başına kelime sayısı" kabulüdür:
  A1 ≈ en sık 600, A2 ≈ 1200, B1 ≈ 2500, B2 ≈ 5000, C1 ≈ 10000, ötesi C2. Yaklaşıktır.
"""

import re
import threading

import simplemma
from wordfreq import top_n_list, word_frequency

LANG = "es"
WORD = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+")
TAGS = re.compile(r"[\[(][^\])]*[\])]")  # [Música], (Aplausos)

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
LEVEL_RANKS = [(600, "A1"), (1200, "A2"), (2500, "B1"), (5000, "B2"), (10000, "C1")]
BASIC_RANK = 300        # en sık bu kadar yalın hâl "Temel" grubuna gider (İngilizcedeki is_basic karşılığı)
FREQUENCY_POOL = 40000  # sıklık sırası için wordfreq'in en sık kaç kelimesine bakılır

# Görev kelimeleri: bağlamsız çeviride yanlış çıkıyor, anlam ve türleri elle yazıldı.
# Anahtar simplemma'nın verdiği yalın hâldir (la, los, las → el; una → uno).
FUNCTION_WORDS = {
    "el": ("tanımlık", "belirli tanımlık (el, la, los, las); Türkçede karşılığı yok"),
    "uno": ("tanımlık", "bir; biri"),
    "lo": ("zamir", "onu; -an şey (lo bueno: iyi olan)"),
    "al": ("edat", "a + el: -e, -a"),
    "del": ("edat", "de + el: -in; -den"),
    "de": ("edat", "-in (iyelik); -den"),
    "a": ("edat", "-e, -a"),
    "en": ("edat", "içinde, -de"),
    "con": ("edat", "ile"),
    "por": ("edat", "yüzünden; tarafından; boyunca"),
    "para": ("edat", "için; -e doğru"),
    "sin": ("edat", "-sız, olmadan"),
    "sobre": ("edat", "üzerinde; hakkında"),
    "entre": ("edat", "arasında"),
    "hasta": ("edat", "-e kadar"),
    "desde": ("edat", "-den beri; -den"),
    "y": ("bağlaç", "ve"),
    "e": ("bağlaç", "ve (i-/hi- ile başlayan kelimeden önce)"),
    "o": ("bağlaç", "veya"),
    "u": ("bağlaç", "veya (o- ile başlayan kelimeden önce)"),
    "pero": ("bağlaç", "ama"),
    "que": ("bağlaç", "ki; -den (daha); -an"),
    "porque": ("bağlaç", "çünkü"),
    "si": ("bağlaç", "eğer"),
    "como": ("bağlaç", "gibi; olarak"),
    "cuando": ("bağlaç", "-dığında"),
    "donde": ("bağlaç", "-dığı yer"),
    "ni": ("bağlaç", "ne … ne"),
    "yo": ("zamir", "ben"),
    "tú": ("zamir", "sen"),
    "él": ("zamir", "o (erkek)"),
    "ella": ("zamir", "o (kadın)"),
    "nosotros": ("zamir", "biz"),
    "vosotros": ("zamir", "siz"),
    "ellos": ("zamir", "onlar"),
    "usted": ("zamir", "siz (nezaket)"),
    "ustedes": ("zamir", "sizler (nezaket)"),
    "me": ("zamir", "beni, bana"),
    "te": ("zamir", "seni, sana"),
    "se": ("zamir", "kendini; ona (le yerine)"),
    "nos": ("zamir", "bizi, bize"),
    "os": ("zamir", "sizi, size"),
    "le": ("zamir", "ona"),
    "mi": ("zamir", "benim"),
    "tu": ("zamir", "senin"),
    "su": ("zamir", "onun; onların; sizin"),
    "nuestro": ("zamir", "bizim"),
    "vuestro": ("zamir", "sizin"),
    "este": ("belirteç", "bu"),
    "ese": ("belirteç", "şu, o"),
    "aquel": ("belirteç", "o (uzaktaki)"),
    "esto": ("zamir", "bu (şey)"),
    "eso": ("zamir", "şu, o (şey)"),
    "qué": ("zamir", "ne"),
    "quién": ("zamir", "kim"),
    "cuál": ("zamir", "hangi"),
    "no": ("zarf", "değil; hayır"),
    "sí": ("zarf", "evet"),
}

# Tek heceli bu kelimeler cümlede vurgusuz okunur: IPA'larına vurgu işareti konmaz
UNSTRESSED = {"el", "la", "los", "las", "lo", "un", "al", "del", "de", "a", "en", "con", "por", "sin", "y", "e", "o", "u",
              "que", "si", "ni", "me", "te", "se", "nos", "os", "le", "les", "mi", "mis", "tu", "tus", "su", "sus"}


# ===== Sıklık sırası ve seviye =====

rank_lock = threading.Lock()
lemma_rank = None  # yalın hâl -> sıra (0 en sık); ilk kullanımda kurulur (~1,5 sn)
verb_lemmas = set()  # sıklık listesinde çekimli biçimi görülen mastarlar (tür tahmini için; ranks() doldurur)
# Bu eklerle biten ve mastara inen biçim görülürse yalın hâl fiildir (lugar, mujer gibi -ar/-er isimler elensin)
VERB_FORM_ENDINGS = ("ando", "iendo", "yendo", "aba", "aban", "ía", "ían", "ó", "aron", "ieron", "amos", "emos", "imos",
                     "ado", "ido", "aste", "iste")
lemma_cache = {}


def lemma_of(word):
    word = word.lower()
    if word not in lemma_cache:
        lemma_cache[word] = simplemma.lemmatize(word, lang=LANG).lower()
    return lemma_cache[word]


def ranks():
    global lemma_rank
    with rank_lock:
        if lemma_rank is None:
            totals = {}
            for word in top_n_list(LANG, FREQUENCY_POOL):
                if WORD.fullmatch(word):
                    lemma = lemma_of(word)
                    totals[lemma] = totals.get(lemma, 0) + word_frequency(word, LANG)
                    if lemma != word and lemma.endswith(("ar", "er", "ir", "ír")) and word.endswith(VERB_FORM_ENDINGS):
                        verb_lemmas.add(lemma)
            ordered = sorted(totals.items(), key=lambda item: -item[1])
            lemma_rank = {lemma: index for index, (lemma, _) in enumerate(ordered)}
    return lemma_rank


def level_of(lemma):
    rank = ranks().get(lemma)
    if rank is None:
        return "C2"
    return next((level for limit, level in LEVEL_RANKS if rank < limit), "C2")


def is_known(word):
    """Sözlükteki bir İspanyolca kelime mi (özel ad, yabancı kelime, yazım hatası değil)?"""
    word = word.lower()
    return simplemma.is_known(word, lang=LANG) or lemma_of(word) in ranks()


def is_basic(lemma):
    return lemma in FUNCTION_WORDS or ranks().get(lemma, 10 ** 9) < BASIC_RANK


def pos_of(word, lemma):
    """Kaba tür tahmini (simplemma tür vermez): çekimli biçimi görülen mastarlar ve -mente zarfları."""
    if lemma in FUNCTION_WORDS:
        return FUNCTION_WORDS[lemma][0]
    ranks()  # verb_lemmas'ı doldurur
    if lemma in verb_lemmas:
        return "fiil"
    if lemma.endswith("mente"):
        return "zarf"
    return ""


# ===== Telaffuz (İspanya aksanı) =====

STRONG = {"a": "a", "e": "e", "o": "o", "á": "a", "é": "e", "ó": "o", "í": "i", "ú": "u"}  # vurgulu í/ú ayrı hece olur
WEAK = {"i": "i", "u": "u", "ü": "u"}
ACCENTED = set("áéíóú")
FRONT = set("eéií")
PLAIN = {"b": "b", "v": "b", "d": "d", "f": "f", "k": "k", "l": "l", "m": "m", "n": "n", "p": "p", "s": "s", "t": "t",
         "w": "w", "ñ": "ɲ", "j": "x", "z": "θ"}
# Hece başında birlikte durabilen ünsüz çiftleri: pl, br, tr, gl... (tl ve dl İspanya'da ayrılır: at-las)
ONSET_FIRST = {"p", "b", "f", "k", "g", "t", "d"}
ONSET_SECOND = {"l", "ɾ"}
GLIDE = {"i": "j", "u": "w"}


def segments(word):
    """Kelimeyi ses birimlerine ayırır: ("C", ipa) ünsüz, ("V", ünlü, güçlü mü, vurgulu mu) ünlü."""
    out = []
    i = 0
    n = len(word)
    while i < n:
        ch = word[i]
        nxt = word[i + 1] if i + 1 < n else ""
        nxt2 = word[i + 2] if i + 2 < n else ""
        if ch in STRONG:  # vurgulu í/ú de güçlü sayılır: komşu ünlüden ayrı hece olur (dí-a)
            out.append(("V", STRONG[ch], True, ch in ACCENTED))
        elif ch in WEAK:
            out.append(("V", WEAK[ch], False, False))
        elif ch == "c":
            if nxt == "h":
                out.append(("C", "tʃ"))
                i += 1
            else:
                out.append(("C", "θ" if nxt in FRONT else "k"))
        elif ch == "l" and nxt == "l":
            out.append(("C", "ʝ"))
            i += 1
        elif ch == "r":
            if nxt == "r":
                out.append(("C", "r"))
                i += 1
            else:
                out.append(("C", "r" if i == 0 or word[i - 1] in "nls" else "ɾ"))
        elif ch == "q":
            out.append(("C", "k"))
            if nxt == "u":
                i += 1
        elif ch == "g":
            if nxt == "u" and nxt2 in FRONT:  # gue, gui: u okunmaz
                out.append(("C", "g"))
                i += 1
            else:
                out.append(("C", "x" if nxt in FRONT else "g"))
        elif ch == "h":
            pass  # okunmaz (ch yukarıda)
        elif ch == "x":
            if i == 0:
                out.append(("C", "s"))
            else:
                out += [("C", "k"), ("C", "s")]
        elif ch == "y":
            if n == 1 or (i == n - 1 and i > 0 and word[i - 1] in "aeiouáéíóú"):
                out.append(("V", "i", False, False))  # y (ve), hoy, muy: ünlü gibi
            elif nxt and nxt in "aeiouáéíóúü":
                out.append(("C", "ʝ"))
            else:
                out.append(("V", "i", False, False))
        elif ch in PLAIN:
            out.append(("C", PLAIN[ch]))
        else:
            return []  # İspanyolcada olmayan harf
        i += 1
    return out


def nuclei(vowels):
    """Art arda gelen ünlüleri hecelere böler: iki güçlü ünlü ayrılır (le-er), zayıf ünlü komşusuyla birleşir (cie-lo)."""
    groups = [[vowels[0]]]
    for vowel in vowels[1:]:
        if vowel[2] and any(v[2] for v in groups[-1]):
            groups.append([vowel])
        else:
            groups[-1].append(vowel)
    result = []
    for group in groups:
        peak = next((k for k, v in enumerate(group) if v[2]), len(group) - 1)  # güçlü yoksa (ciu-dad) sonuncusu
        ipa = "".join(v[1] if k == peak else GLIDE.get(v[1], v[1]) for k, v in enumerate(group))
        result.append((ipa, any(v[3] for v in group)))
    return result


def onset_ok(cluster):
    if len(cluster) <= 1:
        return True
    return len(cluster) == 2 and cluster[0] in ONSET_FIRST and cluster[1] in ONSET_SECOND and cluster not in (["t", "l"], ["d", "l"])


def syllables(word):
    """'estación' -> [{"ipa": "es", "stress": 0}, {"ipa": "ta", "stress": 0}, {"ipa": "θjon", "stress": 1}]. Çözülemezse []."""
    word = word.lower()
    parts = segments(word)
    if not parts:
        return []
    # Ünlü dizilerini hece çekirdeklerine, aradaki ünsüzleri kümelere ayır
    units = []  # ("N", ipa, vurgulu mu) ya da ("C", ipa)
    run = []
    for part in parts + [("END",)]:
        if part[0] == "V":
            run.append(part)
            continue
        if run:
            units += [("N", ipa, accented) for ipa, accented in nuclei(run)]
            run = []
        if part[0] == "C":
            units.append(part)
    nucleus_at = [k for k, unit in enumerate(units) if unit[0] == "N"]
    if not nucleus_at:
        return []
    starts = [0]
    for previous, current in zip(nucleus_at, nucleus_at[1:]):
        cluster = [units[k][1] for k in range(previous + 1, current)]
        keep = 2 if len(cluster) >= 2 and onset_ok(cluster[-2:]) else min(1, len(cluster))
        starts.append(current - keep)
    pieces = []
    for begin, end in zip(starts, starts[1:] + [len(units)]):
        chunk = units[begin:end]
        pieces.append({"ipa": "".join(u[1] for u in chunk), "accent": any(u[0] == "N" and u[2] for u in chunk)})

    # Vurgu: yazılı vurgu işareti varsa o hece; yoksa ünlü, n ya da s ile biten kelimede sondan ikinci, ötekilerde son hece
    count = len(pieces)
    stressed = next((k for k, piece in enumerate(pieces) if piece["accent"]), None)
    if stressed is None:
        stressed = count - 2 if count >= 2 and word[-1] in "aeiouns" else count - 1
    if count == 1 and word in UNSTRESSED:
        stressed = None
    return [{"ipa": piece["ipa"], "stress": 1 if k == stressed else 0} for k, piece in enumerate(pieces)]


syllabify = syllables  # İngilizce paketle (ipa.syllabify) aynı ad

ipa_cache = {}


def word_to_ipa(word):
    """'estación' -> 'estaˈθjon'. Sözlükte olmayan kelime (özel ad, yabancı kelime) → ''."""
    key = word.lower()
    if key not in ipa_cache:
        parts = syllables(key) if is_known(key) else []
        ipa_cache[key] = "".join(("ˈ" if part["stress"] else "") + part["ipa"] for part in parts)
    return ipa_cache[key]


def token_to_ipa(token):
    """'¿Estación?' -> 'estaˈθjon'  /  '[Música]' -> ''  /  '1990' -> ''"""
    if token.startswith(("[", "(")) and token.endswith(("]", ")")):
        return ""
    pieces = [word_to_ipa(w) for w in WORD.findall(token)]
    if not pieces or any(p == "" for p in pieces):
        return ""
    return " ".join(pieces)


def prepare_ipa(tokens):
    """İngilizce paketle aynı imza; İspanyolcada toplu sorgu gerekmez, sıklık tablosunu önceden kurar."""
    ranks()


# ===== Videodaki kelimeler =====

def word_forms(word, texts):
    """Kayıtlı metinlerde aranan kelimeyle aynı yalın hâle inen bütün biçimler (hablar → hablo, habló, hablando…)."""
    target = lemma_of(word)
    forms = {word.lower(), target}
    for text in texts:
        for token in WORD.findall(text):
            token = token.lower()
            if token not in forms and lemma_of(token) == target:
                forms.add(token)
    return forms


def build_vocab(lines, translate_all, translations):
    """İngilizce vocab.build_vocab ile aynı biçim: {"levels", "phrasal": [], "basic", "translationError"}."""
    words = {}
    casing = {}
    for line in lines:
        raw_tokens = WORD.findall(TAGS.sub(" ", line["text"]))
        for position, raw in enumerate(raw_tokens):
            token = raw.lower()
            stats = casing.setdefault(token, [0, 0])
            if raw[0].islower():
                stats[0] += 1
            elif position > 0:
                stats[1] += 1
            lemma = lemma_of(token)
            if (len(token) == 1 and lemma not in FUNCTION_WORDS) or not is_known(token):
                continue
            entry = words.setdefault(lemma, {"word": lemma, "count": 0, "start": line["start"], "forms": set()})
            entry["count"] += 1
            entry["forms"].add(token)

    def is_proper_noun(entry):  # hiç küçük harfle geçmeyip cümle ortasında büyük harfle geçenler (Madrid, NASA)
        return all(casing[f][0] == 0 and casing[f][1] > 0 for f in entry["forms"])

    kept = [e for e in words.values() if not is_proper_noun(e)]
    error = translate_all([e["word"] for e in kept if e["word"] not in FUNCTION_WORDS])

    levels = {level: [] for level in LEVELS}
    basic = []
    for entry in kept:
        lemma = entry["word"]
        level = level_of(lemma)
        if lemma in FUNCTION_WORDS:
            meaning = FUNCTION_WORDS[lemma][1]
        else:
            meaning = translations.get(lemma, "")
            if meaning.lower() == lemma:  # çevrilmeden aynen dönen
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
        items.sort(key=lambda item: (-item["count"], item["word"]))
    return {"levels": levels, "phrasal": [], "basic": basic, "translationError": error}
