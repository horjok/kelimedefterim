"""Canlı kontrol: sahte servislerin taklit ettiği gerçek servisler hâlâ aynı biçimde mi yanıt veriyor?

Otomatik test keşfine girmez (adı test_ ile başlamaz); internet ister, elle çalıştırılır:
    python -m tests.canli_kontrol

YouTube transkripti (Almanca, İspanyolca, İngilizce), Google çeviri, Wiktionary, Spotify oEmbed ve LRCLIB'e birkaç istek atar.
Gemini çağrılmaz (kota harcamaz). Önbellek geçici klasörde; gerçek Redis'e ve cache/'e yazılmaz.
YouTube, Google, Spotify ya da LRCLIB o an engelliyorsa kontrol "ATLANDI" der: bu kodda hata olduğu anlamına gelmez.
Şarkı kontrolü söz metnini yazdırmaz: yalnızca alan adları, sayılar ve geçti/kaldı çıkar (telif).
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

# Şarkı kontrolü için tek, herkesçe bilinen herkese açık Spotify şarkısı (söz metni hiçbir yere yazdırılmaz)
SONG_ID = "4PTG3Z6ehGkBFwjybzWkR8"
CANDIDATE_FIELDS = {"id", "artist", "track", "album", "duration"}

# Herkese açık, elle altyazılı videolar (dil, video id, listede olması beklenen kelime)
VIDEOS = [("de", "g-bYI2YP9gE", "Straße"), ("es", "2VssbS3dFy8", None), ("en", "5FBdxyfBxM8", None)]


def check_song(client, check):
    """Spotify oEmbed + LRCLIB: gerçek yanıt biçimleri songs.py ve tests/support.py'nin taklit ettiğiyle uyuşuyor mu?"""
    from backend import songs

    track_url = f"https://open.spotify.com/track/{SONG_ID}"
    try:
        meta = songs.song_meta(SONG_ID)
    except songs.SongError as exc:
        print(f"ATLANDI şarkı (Spotify oEmbed): kod {exc.status}")
        return
    check("Spotify oEmbed başlık", bool(meta["title"]), "başlık var" if meta["title"] else "başlık yok")
    check("Spotify oEmbed alanları", set(meta) == {"title", "thumbnail"}, ",".join(sorted(meta)))

    try:
        candidates = songs.find_lyrics(meta["title"])
    except songs.SongError as exc:
        print(f"ATLANDI şarkı (LRCLIB arama): kod {exc.status}")
        return
    check("LRCLIB arama aday döndürdü", len(candidates) > 0, f"{len(candidates)} aday")
    if not candidates:
        return
    check("LRCLIB aday alanları", all(CANDIDATE_FIELDS <= set(c) for c in candidates), ",".join(sorted(candidates[0])))
    check("LRCLIB adayları senkronlu söz taşıyor", all(c["synced"].strip() for c in candidates))
    rows = songs.parse_lrc(candidates[0]["synced"])
    check("syncedLyrics satırlara ayrıldı", len(rows) > 10, f"{len(rows)} satır")
    check("LRC satırı (başlangıç, süre, metin) biçiminde", all(len(row) == 3 and row[1] > 0 for row in rows))

    # Uçtan uca: aday listesi (söz metni olmadan), seçimle şarkı, kelime listesi
    response = client.get("/api/song", query_string={"url": track_url, "choose": "1", "lang": "en"})
    data = response.get_json(silent=True) or {}
    check("/api/song aday listesi", response.status_code == 200 and data.get("choose") is True and bool(data.get("candidates")),
          f"kod {response.status_code}")
    check("aday listesinde söz metni yok", all("synced" not in c for c in data.get("candidates", [])))
    response = client.get("/api/song", query_string={"url": track_url, "lyrics": str(candidates[0]["id"]), "lang": "en"})
    data = response.get_json(silent=True) or {}
    check("/api/song şarkıyı kurdu", response.status_code == 200 and data.get("videoId") == f"sp:{SONG_ID}"
          and data.get("kind") == "song" and len(data.get("lines", [])) > 10, f"kod {response.status_code}, {len(data.get('lines', []))} satır")
    if response.status_code != 200:
        return
    check("satırlarda zaman ve kelime alanları", all({"start", "end", "text", "words"} <= set(line) for line in data["lines"]))
    response = client.get("/api/vocab", query_string={"url": track_url, "lang": "en"})
    vocab = response.get_json(silent=True) or {}
    if response.status_code == 503:
        print("ATLANDI şarkı kelime listesi: çeviri servisi sınırlıyor")
    else:
        count = sum(len(items) for items in vocab.get("levels", {}).values())
        check("şarkı kelime listesi", response.status_code == 200 and count > 5, f"kod {response.status_code}, {count} kelime")


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

    check_song(client, check)

    shutil.rmtree(TMP, ignore_errors=True)
    print("Sonuç:", "hepsi geçti" if not failures else f"{len(failures)} hata")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
