"""Yollar ve ayarlar: bütün modüller klasör adlarını buradan alır."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # proje kökü
WEB_DIR = ROOT / "web"                         # tarayıcıya sunulan dosyalar (HTML, css/, js/)
KEY_FILE = ROOT / "gemini_key.txt"             # Gemini anahtarı (kullanıcı oluşturur; içeriğini hiçbir yere yazma)

# Vercel her fonksiyona VERCEL=1 verir. Orada dosya sistemi salt okunur, yazılabilen tek yer /tmp (geçici).
ON_VERCEL = bool(os.environ.get("VERCEL"))

# Önbellek klasörü: yerelde cache/, Vercel'de /tmp altı. Kalıcı depo (Upstash Redis) varsa storage.py onu kullanır.
CACHE_DIR = Path(os.environ.get("CACHE_DIR") or ("/tmp/kelime-defteri-cache" if ON_VERCEL else ROOT / "cache"))

# Siteye giriş şifresi (HTTP Basic). Boşsa yerelde şifre sorulmaz; Vercel'de şifresiz site açılmaz (APP_PUBLIC=1 hariç).
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
APP_PUBLIC = os.environ.get("APP_PUBLIC", "") == "1"

HOST = "127.0.0.1"
PORT = 8000
