"""
Önbellek deposu: üretilen verinin (çeviriler, transkriptler, gramer, kelime haznesi, anlatımlar, IELTS setleri)
okunup yazıldığı tek yer.

- Upstash Redis ayarlıysa (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN ya da Vercel'in KV_REST_API_URL +
  KV_REST_API_TOKEN adları) veri orada durur: Vercel'de kalıcı olan budur. İstekler REST API ile, ek paket olmadan.
- Yoksa cache/ klasörüne (Vercel'de /tmp altına, geçici) dosya olarak yazılır.

Adlar klasör yolu gibidir: "translations.json", "wordbank/B1.json", "transcripts/<id>.json".
Okuma hatasında varsayılan değer döner, yazma hatası günlüğe düşer: hiçbir fonksiyon istisna fırlatmaz.

Yerel önbelleği Redis'e taşımak için (ortam değişkenleri ayarlıyken):
    python -m backend.storage upload
"""

import json
import logging
import os
import re
import sys
import threading
import urllib.request

from .config import CACHE_DIR

log = logging.getLogger("kelime-defteri")

REDIS_URL = (os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL") or "").rstrip("/")
REDIS_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN") or ""
USE_REDIS = bool(REDIS_URL and REDIS_TOKEN)
PREFIX = "kd:"            # Redis anahtarlarının öneki (aynı veritabanı başka işte de kullanılırsa karışmasın)
INDEX = "kd:idx:"         # klasör başına ad listesi (Redis kümesi): kd:idx:transcripts -> {"transcripts/abc.json", ...}
TIMEOUT = 10
NAME = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.json$")
UPLOAD_SKIP = ("wordlists/",)  # içe aktarılan kelime listesi telifli bir derleme: yalnızca yerelde kalır
file_lock = threading.Lock()


def backend_name():
    return "redis" if USE_REDIS else "disk"


# ===== Redis (Upstash REST) =====

def redis(*commands):
    """Komutları tek istekte gönderir (pipeline), sonuçları sırayla döndürür. Hata: OSError/ValueError."""
    body = json.dumps([list(command) for command in commands]).encode("utf-8")
    request = urllib.request.Request(REDIS_URL + "/pipeline", data=body, method="POST", headers={
        "Authorization": "Bearer " + REDIS_TOKEN, "Content-Type": "application/json",
    })
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        replies = json.loads(response.read().decode("utf-8"))
    results = []
    for reply in replies:
        if "error" in reply:
            raise ValueError("Redis: " + str(reply["error"])[:200])
        results.append(reply.get("result"))
    return results


def folder_of(name):
    return name.rsplit("/", 1)[0] if "/" in name else ""


# ===== Dışarıya açılan fonksiyonlar =====

def read(name, default=None):
    """Kayıtlı JSON değeri; yoksa ya da okunamazsa default."""
    if not NAME.match(name):
        return default
    try:
        if USE_REDIS:
            raw = redis(["GET", PREFIX + name])[0]
            return default if raw is None else json.loads(raw)
        return json.loads((CACHE_DIR / name).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        if not isinstance(exc, FileNotFoundError):
            log.warning("Önbellek okunamadı (%s): %s", name, exc)
        return default


def write(name, data):
    """JSON olarak yazar. Başarılıysa True; yazılamazsa günlüğe yazar ve False döner (istek bozulmaz)."""
    if not NAME.match(name):
        return False
    text = json.dumps(data, ensure_ascii=False)
    try:
        if USE_REDIS:
            commands = [["SET", PREFIX + name, text]]
            if folder_of(name):
                commands.append(["SADD", INDEX + folder_of(name), name])
            redis(*commands)
        else:
            path = CACHE_DIR / name
            with file_lock:
                path.parent.mkdir(parents=True, exist_ok=True)
                temp = path.with_suffix(".tmp")
                temp.write_text(text, encoding="utf-8")
                os.replace(temp, path)  # yarım yazılmış dosya kalmasın
        return True
    except (OSError, ValueError) as exc:
        log.warning("Önbellek yazılamadı (%s): %s", name, exc)
        return False


def merge_write(name, data):
    """Sözlük biçimli önbellekler için: depodaki güncel hâlle birleştirip yazar.
    Vercel'de aynı anda birden çok kopya çalışabilir; başka kopyanın eklediği anahtarlar böylece silinmez.
    data yerinde güncellenir (öteki kopyaların eklediği anahtarlar da gelir)."""
    stored = read(name, {})
    if isinstance(stored, dict):
        for key, value in stored.items():
            data.setdefault(key, value)
    return write(name, data)


def read_folder(folder, limit=500):
    """Klasördeki bütün kayıtlar: [değer, ...]. Okunamayanlar atlanır."""
    try:
        if USE_REDIS:
            names = sorted(redis(["SMEMBERS", INDEX + folder])[0] or [])[:limit]
            result = []
            for start in range(0, len(names), 50):  # tek istek çok büyümesin
                chunk = names[start:start + 50]
                for raw in redis(["MGET", *[PREFIX + name for name in chunk]])[0] or []:
                    try:
                        if raw is not None:
                            result.append(json.loads(raw))
                    except ValueError:
                        continue
            return result
        directory = CACHE_DIR / folder
        if not directory.is_dir():
            return []
        result = []
        for path in sorted(directory.glob("*.json"))[:limit]:
            try:
                result.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
        return result
    except (OSError, ValueError) as exc:
        log.warning("Önbellek klasörü okunamadı (%s): %s", folder, exc)
        return []


# ===== Yerel önbelleği Redis'e taşıma =====

def upload(source=None):
    """cache/ klasöründeki JSON dosyalarını Redis'e yazar (kelime listesi hariç)."""
    if not USE_REDIS:
        print("Redis ayarlı değil: UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN ortam değişkenlerini ver.")
        return 1
    root = source or CACHE_DIR
    done = failed = 0
    for path in sorted(root.rglob("*.json")):
        name = path.relative_to(root).as_posix()
        if name.startswith(UPLOAD_SKIP) or not NAME.match(name):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            failed += 1
            continue
        if write(name, data):
            done += 1
        else:
            failed += 1
    print(f"Redis'e yazıldı: {done}, yazılamadı: {failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["upload"]:
        sys.exit(upload())
    print(__doc__)
