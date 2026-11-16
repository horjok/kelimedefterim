"""Yollar ve ayarlar: bütün modüller klasör adlarını buradan alır."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # proje kökü
WEB_DIR = ROOT / "web"                         # tarayıcıya sunulan dosyalar (HTML, css/, js/)
KEY_FILE = ROOT / "gemini_key.txt"             # Gemini anahtarı (kullanıcı oluşturur; içeriğini hiçbir yere yazma)
ENV_FILES = (ROOT / ".env.local", ROOT / ".env")  # yerelde ortam değişkenleri (git'e ve Vercel'e girmez)
ENV_SKIP = ("APP_PASSWORD", "APP_PUBLIC", "VERCEL")  # yerel sunucu Vercel gibi davranmasın, şifre sormasın


def load_env_files():
    """Yerelde .env.local / .env dosyasındaki KEY=değer satırlarını ortam değişkenlerine ekler (ek paket yok).
    Amaç: yerel sunucu Vercel'deki aynı Upstash Redis'i kullansın; yerelde açılan videonun transkripti Redis'e yazılır,
    Vercel oradan okur (YouTube Vercel'i engelliyor). Terminalde verilen değişken dosyadakini ezer.
    `vercel env pull .env.local` ile gelen VERCEL* değişkenleri ve giriş şifresi atlanır."""
    if os.environ.get("VERCEL"):
        return
    for file in ENV_FILES:
        try:
            lines = file.read_text(encoding="utf-8-sig").splitlines()
        except OSError:
            continue
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip().removeprefix("export ").strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            if key and not key.startswith(ENV_SKIP):
                os.environ.setdefault(key, value)


load_env_files()

# Vercel her fonksiyona VERCEL=1 verir. Orada dosya sistemi salt okunur, yazılabilen tek yer /tmp (geçici).
ON_VERCEL = bool(os.environ.get("VERCEL"))

# Önbellek klasörü: yerelde cache/, Vercel'de /tmp altı. Kalıcı depo (Upstash Redis) varsa storage.py onu kullanır.
CACHE_DIR = Path(os.environ.get("CACHE_DIR") or ("/tmp/kelime-defteri-cache" if ON_VERCEL else ROOT / "cache"))

# Siteye giriş şifresi (HTTP Basic). Boşsa yerelde şifre sorulmaz; Vercel'de şifresiz site açılmaz (APP_PUBLIC=1 hariç).
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
APP_PUBLIC = os.environ.get("APP_PUBLIC", "") == "1"

HOST = "127.0.0.1"
PORT = 8000
