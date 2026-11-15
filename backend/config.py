"""Yollar ve ayarlar: bütün modüller klasör adlarını buradan alır."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # proje kökü
WEB_DIR = ROOT / "web"                         # tarayıcıya sunulan dosyalar (HTML, css/, js/)
CACHE_DIR = ROOT / "cache"                     # çeviri, gramer ve transkript önbellekleri
TRANSCRIPT_DIR = CACHE_DIR / "transcripts"     # her video için <id>.json
KEY_FILE = ROOT / "gemini_key.txt"             # Gemini anahtarı (kullanıcı oluşturur; içeriğini hiçbir yere yazma)

HOST = "127.0.0.1"
PORT = 8000
