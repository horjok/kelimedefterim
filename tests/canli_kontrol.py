"""Canlı kontrol: sahte servislerin taklit ettiği gerçek servisler hâlâ aynı biçimde mi yanıt veriyor?

Otomatik test keşfine girmez (adı test_ ile başlamaz); internet ister, elle çalıştırılır:
    python -m tests.canli_kontrol

YouTube transkripti (Almanca, İspanyolca, İngilizce), Google çeviri ve Wiktionary'ye birkaç istek atar.
Gemini çağrılmaz (kota harcamaz). Önbellek geçici klasörde; gerçek Redis'e ve cache/'e yazılmaz.
YouTube ya da Google o an engelliyorsa kontrol "ATLANDI" der: bu kodda hata olduğu anlamına gelmez.
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="kd-canli-"))
for name in ("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"):
    os.environ[name] = ""
for name in ("VERCEL", "APP_PASSWORD"):
    os.environ.pop(name, None)
os.environ["CACHE_DIR"] = str(TMP)
sys.path.insert(0, str(ROOT))

from backend.app import app  # noqa: E402

# Herkese açık, elle altyazılı videolar (dil, video id, listede olması beklenen kelime)
VIDEOS = [("de", "g-bYI2YP9gE", "Straße"), ("es", "2VssbS3dFy8", None), ("en", "5FBdxyfBxM8", None)]


def main():
    client = app.test_client()
    failures = []

    def check(name, ok, info=""):
        print(("OK      " if ok else "HATA    ") + name + (f"  [{info}]" if info else ""))
        if not ok:
            failures.append(name)

    for lang, video, expected in VIDEOS:
        response = client.get("/api/vocab", query_string={"url": video, "lang": lang})
        data = response.get_json(silent=True) or {}
        if response.status_code == 503:
            print(f"ATLANDI {lang} transkript: {data.get('error')}")
            continue
        check(f"{lang} kelime listesi", response.status_code == 200, f"kod {response.status_code}")
        if response.status_code != 200:
            continue
        counts = {level: len(items) for level, items in data["levels"].items()}
        words = {item["word"] for items in data["levels"].values() for item in items} | {item["word"] for item in data["basic"]}
        check(f"{lang} seviyeler dolu", sum(counts.values()) > 20, str(counts))
        if data["translationError"]:
            print(f"ATLANDI {lang} çeviri: {data['translationError']}")
        else:
            with_meaning = sum(1 for items in data["levels"].values() for item in items if item["tr"])
            check(f"{lang} anlamlar geldi", with_meaning > sum(counts.values()) // 2, f"{with_meaning} anlamlı")
        if expected:
            check(f"{lang} '{expected}' listede", expected in words)

    response = client.get("/api/translate", query_string={"text": "Ich wohne in Berlin.", "lang": "de"})
    if response.status_code == 503:
        print("ATLANDI cümle çevirisi: Google sınırlıyor")
    else:
        check("cümle çevirisi", response.status_code == 200 and "Berlin" in response.get_json()["tr"], response.get_data(as_text=True)[:80])

    from backend import wordbank
    example = wordbank.fetch_example_es(("Haus", "NOUN"), "de")
    check("Wiktionary yanıt biçimi", example is not None, repr(example)[:80])

    shutil.rmtree(TMP, ignore_errors=True)
    print("Sonuç:", "hepsi geçti" if not failures else f"{len(failures)} hata")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
