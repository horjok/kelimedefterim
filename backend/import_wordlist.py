"""
Kendi kelime listeni (PDF) Pekiştir haznesine kaynak olarak içe aktarır.

Kullanım (proje kökünden):
    python -m backend.import_wordlist "C:/.../The_Oxford_5000_by_CEFR_level.pdf" "Oxford 5000"

- PDF'te seviye başlıkları (A1 … C2) ve altlarında "kelime tür." satırları beklenir (ör. "absorb v.").
- Sonuç cache/wordlists/liste.json içine yazılır. cache/ klasörü git'e girmez: liste senin dosyandan, yalnızca
  senin bilgisayarında durur; depoya eklenmez ve eklenmemeli (liste yayıncısının telifli derlemesidir).
- Yalnızca küçük harfli tek kelimeler alınır (tireli ve çok kelimeli öğeler atlanır); aynı kelime bir kez alınır.
- Anlam ve örnek cümle burada üretilmez; kelime ilk istendiğinde wordbank.fill_from_dictionary getirir (Gemini'siz).
- Gerekli paket: pdfminer.six (pip install pdfminer.six). Uygulamanın kendisi bu pakete ihtiyaç duymaz.
"""

import json
import re
import sys

from .config import CACHE_DIR
from .vocab import LEVELS

LIST_FILE = CACHE_DIR / "wordlists" / "liste.json"
POS_FROM_LIST = {"n": "NOUN", "v": "VERB", "adj": "ADJ", "adv": "ADV"}
# "console2 n." · "counter (long flat surface) n." · "bow1 v., n." → kelime, (sıra no), (açıklama), türler
ENTRY = re.compile(r"^([a-z]+(?:-[a-z]+)*)\d?\s*(?:\([^)]*\))?\s+([a-z].*)$")
POS_TOKEN = re.compile(r"^(modal v|auxiliary v|adj|adv|prep|conj|pron|det|exclam|number|n|v)\b")


def parse_wordlist(text):
    """Metinden {seviye: [[kelime, tür | None], ...]} ve atlanan satır sayısını çıkarır."""
    levels = {}
    seen = set()
    current = None
    skipped = 0
    for raw in text.splitlines():
        line = raw.strip()
        if line in LEVELS:
            current = line
            continue
        match = ENTRY.match(line)
        pos = POS_TOKEN.match(match.group(2)) if match else None
        if current is None or pos is None:
            continue  # başlık, sayfa numarası, telif satırı
        word = match.group(1)
        if "-" in word or word in seen:
            skipped += 1
            continue
        seen.add(word)
        levels.setdefault(current, []).append([word, POS_FROM_LIST.get(pos.group(1))])
    return levels, skipped


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Kullanım: python -m backend.import_wordlist "liste.pdf" ["Listenin adı"]')
    try:
        from pdfminer.high_level import extract_text
    except ImportError:
        raise SystemExit("pdfminer.six kurulu değil: pip install pdfminer.six")
    levels, skipped = parse_wordlist(extract_text(sys.argv[1]))
    if not levels:
        raise SystemExit("Bu PDF'te seviye başlığı ve 'kelime tür.' satırları bulunamadı.")
    name = sys.argv[2] if len(sys.argv) > 2 else "Kelime listem"
    LIST_FILE.parent.mkdir(parents=True, exist_ok=True)
    LIST_FILE.write_text(json.dumps({"name": name, "levels": levels}, ensure_ascii=False), encoding="utf-8")
    counts = ", ".join(f"{level} {len(words)}" for level, words in levels.items())
    print(f"{name}: {counts} kelime alındı; {skipped} satır atlandı (tireli ya da yinelenen).")


if __name__ == "__main__":
    main()
