"""Entegrasyon testlerinin ortak altyapısı: yalıtılmış ortam + sahte dış servisler.

Bu modül backend'den ÖNCE içe aktarılmalı (her test dosyasının ilk satırı): backend modülleri ortam
değişkenlerini ve önbellekleri içe aktarılırken okur.

- Önbellek: geçici bir klasör (CACHE_DIR); Upstash değişkenleri boş (.env.local'daki gerçek Redis yüklenmez).
- Gemini anahtarı sahte, KEY_FILE var olmayan bir dosyaya çevrilir: gerçek gemini_key.txt hiç okunmaz.
- urllib.request.urlopen sahte ağa (FakeNet) yönlenir; tanınmayan bir adrese istek testi bozar.
- YouTube transkript istemcisi sahte (FakeYouTube); soket açmak yasak (gerçek ağa sızma olmasın).
"""

import atexit
import io
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="kd-entegrasyon-"))
CACHE = TMP / "cache"

# ----- 1. Ortam (backend içe aktarılmadan önce) -----
for name in ("VERCEL", "APP_PASSWORD", "APP_PUBLIC", "YT_PROXY_URL", "WEBSHARE_PROXY_USERNAME",
             "WEBSHARE_PROXY_PASSWORD", "GEMINI_FALLBACK_MODELS"):
    os.environ.pop(name, None)
for name in ("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"):
    os.environ[name] = ""  # load_env_files setdefault kullanır: boş değer .env.local'dakini engeller
os.environ["CACHE_DIR"] = str(CACHE)
os.environ["GEMINI_API_KEY"] = "test-anahtari"
os.environ["GEMINI_MODEL"] = "test-model"
os.environ["GEMINI_FALLBACK_MODELS"] = "test-yedek"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ----- 2. Gerçek ağa çıkışı kapat -----
class NetworkBlocked(RuntimeError):
    pass


def _no_socket(*args, **kwargs):
    raise NetworkBlocked("Testlerde gerçek ağ bağlantısı yasak")


socket.create_connection = _no_socket
socket.socket.connect = _no_socket
socket.socket.connect_ex = _no_socket


# ----- 3. Sahte HTTP yanıtları -----
class FakeResponse(io.BytesIO):
    def __init__(self, payload, status=200):
        super().__init__(payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def http_error(url, code):
    return urllib.error.HTTPError(url, code, f"HTTP {code}", {}, io.BytesIO(b'{"error": {"message": "test"}}'))


# Sahte çeviri sözlüğü: Google'ın gerçekte döndürdüğüne benzer (Almanca isimler büyük harfle, yalın mastar emir gibi)
TRANSLATIONS = {
    "wohnen": "canlı", "zu wohnen": "yaşamak", "zu glauben": "inanmak", "zu fahren": "sürmek",
    "zu gucken": "bakmak", "zu sprechen": "konuşmak", "Bahnhof": "Tren istasyonu", "Straße": "Sokak",
    "Wetter": "Hava", "Schwester": "Kız kardeş", "Fahrrad": "Bisiklet", "Hamburg": "Hamburg", "Kanal": "Kanal",
    "weather": "hava", "to decide": "karar vermek", "beautiful": "güzel", "estación": "istasyon", "vivir": "yaşamak",
}


# Sahte şarkılar (hepsi uydurma; gerçek şarkı sözü yok). Spotify oEmbed başlığı + LRCLIB kayıtları.
SONGS = {"aaaaaaaaaaaaaaaaaaaaa1": "Uydurma Sabah", "aaaaaaaaaaaaaaaaaaaaa2": "Ortak Ad",
         "aaaaaaaaaaaaaaaaaaaaa3": "Sozsuz Parca", "aaaaaaaaaaaaaaaaaaaaa4": "Cancion Inventada",
         "aaaaaaaaaaaaaaaaaaaaa5": "Remasterli Gece - Remastered 2009"}  # Spotify başlığında ek var; LRCLIB'de eksiz kayıtlı

LRC_SABAH = ("[00:01.00] ♪\n[00:05.20] I walk to the station every morning\n[00:09.80] the weather was beautiful\n\n"
             "[00:14.00] ...\n[00:18.50] we sing about the sunrise\n[00:23.00] and nobody is late today\n")
LRC_ORTAK_1 = "[00:02.00] ♪\n[00:06.00] Paper boats drift along the river\n[00:11.00] I count the lamps in the window\n"
LRC_ORTAK_2 = "[00:03.00] Silver trains cross the valley\n[00:08.50] we wave from the open door\n"
LRC_ES = ("[00:02.00] ♪\n[00:06.00] voy a la estación cada mañana\n[00:10.50] la ciudad está tranquila esta noche\n"
          "[00:15.00] mi casa es muy grande\n[00:19.50] todos los días vamos al mar\n")


LRC_GECE = ("[00:03.00] ♪\n[00:07.00] the lamps are quiet tonight\n[00:12.50] we leave the window open\n"
            "[00:18.00] and the river sings along\n")


def lrclib_entry(entry_id, track, artist, duration, synced="", plain="", instrumental=False):
    return {"id": entry_id, "trackName": track, "artistName": artist, "albumName": "Uydurma Albüm",
            "duration": duration, "instrumental": instrumental, "plainLyrics": plain or None, "syncedLyrics": synced or None}


LYRICS = [
    lrclib_entry(9001, "Uydurma Sabah", "Test Sanatci", 200.0, LRC_SABAH, "I walk to the station every morning"),
    lrclib_entry(9002, "Uydurma Sabah", "Test Sanatci", 201.5, LRC_SABAH, "I walk to the station every morning"),
    lrclib_entry(9011, "Ortak Ad", "Ilk Sanatci", 200.0, LRC_ORTAK_1, "Paper boats drift along the river"),
    lrclib_entry(9012, "Ortak Ad", "Ikinci Sanatci", 199.0, LRC_ORTAK_2, "Silver trains cross the valley"),
    lrclib_entry(9021, "Sozsuz Parca", "Duz Sanatci", 150.0, plain="Only plain words here"),
    lrclib_entry(9022, "Sozsuz Parca", "Enstruman Sanatci", 150.0, instrumental=True),
    lrclib_entry(9041, "Remasterli Gece", "Eski Sanatci", 190.0, LRC_GECE, "the lamps are quiet tonight"),
    lrclib_entry(9031, "Cancion Inventada", "Artista Falso", 180.0, LRC_ES, "voy a la estación cada mañana"),
]


class FakeNet:
    """urllib.request.urlopen yerine geçer. Her istek kaydedilir; tanınmayan adres hata sayılır."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.requests = []          # (adres, gövde metni)
        self.unexpected = []        # tanınmayan adresler
        self.gemini_prompts = []    # (model, istem, sistem talimatı)
        self.gemini_mode = "ok"     # ok | quota | overloaded-main | bad_json | timeout
        self.translate_status = 0   # 0 = çalışır; 429/503 = Google hata döner
        self.wiktionary = {}        # kelime -> örnek cümle (yoksa 404)
        self.spotify_down = False   # True = Spotify oEmbed ağ hatası verir

    # --- yönlendirme ---
    def urlopen(self, target, data=None, timeout=None, **kwargs):
        url = target.full_url if isinstance(target, urllib.request.Request) else str(target)
        body = target.data if isinstance(target, urllib.request.Request) else data
        text = body.decode("utf-8") if isinstance(body, bytes) else ""
        self.requests.append((url, text))
        host = urllib.parse.urlparse(url).netloc
        if host == "translate.googleapis.com":
            return self.translate(url, text)
        if host == "generativelanguage.googleapis.com":
            return self.gemini(url, json.loads(text))
        if host == "en.wiktionary.org":
            return self.wiktionary_entry(url)
        if host == "api.dictionaryapi.dev":
            raise http_error(url, 404)  # örnek yok: Gemini denetimi yazar
        if host == "www.youtube.com" and "/oembed" in url:
            video = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["url"][0][-11:]
            return FakeResponse({"title": f"Test videosu {video}"})
        if host == "open.spotify.com" and urllib.parse.urlparse(url).path == "/oembed":
            return self.spotify_oembed(url)
        if host == "lrclib.net":
            return self.lrclib(url)
        self.unexpected.append(url)
        raise urllib.error.URLError(f"testte beklenmeyen adres: {url}")

    def calls(self, host):
        return [(url, text) for url, text in self.requests if urllib.parse.urlparse(url).netloc == host]

    # --- Google çeviri ---
    def translate(self, url, body):
        if self.translate_status:
            raise http_error(url, self.translate_status)
        lines = urllib.parse.parse_qs(body)["q"][0].split("\n")
        out = "\n".join(TRANSLATIONS.get(line, f"tr {line}") for line in lines)
        return FakeResponse([[[out, "\n".join(lines), None, None]], None, "xx"])

    # --- Wiktionary (İspanyolca / Almanca örnek cümle) ---
    def wiktionary_entry(self, url):
        word = urllib.parse.unquote(url.rsplit("/", 1)[1])
        example = self.wiktionary.get(word)
        if example is None:
            raise http_error(url, 404)
        lang, pos = example
        return FakeResponse({lang: [{"partOfSpeech": pos, "definitions": [
            {"definition": "test", "parsedExamples": [{"example": f"Hier steht {word} in einem Satz."}]}]}]})

    # --- Spotify oEmbed ---
    def spotify_oembed(self, url):
        if self.spotify_down:
            raise urllib.error.URLError("spotify kapalı")
        track = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["url"][0].rstrip("/").rsplit("/", 1)[-1]
        if track not in SONGS:
            raise http_error(url, 404)
        return FakeResponse({"title": SONGS[track], "thumbnail_url": f"https://i.scdn.co/image/{track}"})

    # --- LRCLIB ---
    def lrclib(self, url):
        parsed = urllib.parse.urlparse(url)
        if parsed.path == "/api/search":
            name = urllib.parse.parse_qs(parsed.query).get("track_name", [""])[0].lower()
            return FakeResponse([entry for entry in LYRICS if entry["trackName"].lower() == name])
        if parsed.path.startswith("/api/get/"):
            wanted = parsed.path.rsplit("/", 1)[1]
            for entry in LYRICS:
                if str(entry["id"]) == wanted:
                    return FakeResponse(entry)
        raise http_error(url, 404)

    # --- Gemini ---
    def gemini(self, url, payload):
        model = re.search(r"models/([^:]+):", url).group(1)
        prompt = payload["contents"][0]["parts"][0]["text"]
        system = ((payload.get("systemInstruction") or {}).get("parts") or [{}])[0].get("text", "")
        self.gemini_prompts.append((model, prompt, system))
        mode = self.gemini_mode
        if mode == "quota":
            raise http_error(url, 429)
        if mode == "overloaded-main" and model == "test-model":
            raise http_error(url, 503)
        if mode == "timeout":
            raise urllib.error.URLError(TimeoutError("timed out"))
        text = "bu JSON değil" if mode == "bad_json" else json.dumps(gemini_answer(prompt), ensure_ascii=False)
        return FakeResponse({"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]})


def gemini_answer(prompt):
    """İsteme göre biçimi doğru bir yanıt üretir (gerçek modelin döndürdüğü şekilde)."""
    if "Check and repair each entry" in prompt:
        rows = prompt.split("example):\n", 1)[1].splitlines()
        words = []
        for row in rows:
            word, pos, tr, example = [part.strip() for part in row.split("|", 3)]
            noun = word[:1].isupper() or pos == "isim"
            words.append({
                "word": word, "drop": False,
                "pos": {"isim": "noun", "fiil": "verb", "sıfat": "adjective", "zarf": "adverb"}.get(pos, "noun" if noun else "other"),
                "article": "die" if word[:1].isupper() else "",
                "tr": f"anlamı {word.lower()}" if tr.startswith("tr ") or not tr else tr,
                "example": example if example != "NONE" else f"Wir sprechen heute über {word} im Unterricht.",
                "exampleTr": "Bugün derste bunu konuşuyoruz.",
            })
        return {"words": words}
    if "Write a complete grammar lesson" in prompt:
        return {"intro": "Bu yapı bir şeyi anlatır.", "forms": [{"name": "Olumlu", "pattern": "özne + fiil", "example": "Ich helfe dem Mann.", "tr": "Adama yardım ediyorum."}],
                "uses": [{"sub": "", "rule": "Kural.", "example": "Ich danke dir.", "tr": "Sana teşekkür ederim."},
                         {"sub": "", "rule": "İkinci kural.", "example": "Das gehört mir.", "tr": "Bu benim."},
                         {"sub": "", "rule": "Örneksiz kural atılır.", "example": "", "tr": ""}],
                "signals": [], "mistakes": [{"wrong": "Ich helfe den Mann.", "right": "Ich helfe dem Mann.", "why": "helfen Dativ ister."}] * 3,
                "compare": "", "tip": "İpucu."}
    if "in all twelve tenses" in prompt:
        sentence = re.search(r'Sentence: "(.+?)"', prompt).group(1)
        keys = re.search(r"in this order: (.+)\.", prompt).group(1).split(", ")
        rows = [{"key": key, "text": f"{sentence} ({key})", "verb": key.split("-")[0], "tr": f"Türkçesi {n}",
                 "natural": key != "present-continuous", "note": "not" if key == "present-continuous" else ""}
                for n, key in enumerate(keys)]
        if "EKSIK" in sentence:          # model bir zamanı atlarsa yanıt reddedilir
            rows = rows[1:]
        return {"detected": "present-simple", "tenses": rows}
    if '"questions"' in prompt:
        choice = [{"type": "choice", "prompt": f"Ich helfe _____ Mann {n}.", "options": ["dem", "den", "der", "des"],
                   "answer": "dem", "explanation": "Dativ."} for n in range(5)]
        gap = [{"type": "gap", "prompt": f"Er _____ (wohnen) in Berlin {n}.", "answer": "wohnt", "accept": [], "explanation": "Çekim."} for n in range(3)]
        return {"questions": choice + gap}
    if "numbered transcript" in prompt:
        first = re.search(r"^1\. (.+)$", prompt, flags=re.M).group(1)
        return {"topics": [{"title": "Testkonu", "titleTr": "Test konusu", "level": "A2", "pattern": "x + y",
                            "explanation": "Açıklama.", "tip": "İpucu.",
                            "examples": [{"line": 1, "phrase": " ".join(first.split()[:2]), "note": "not"},
                                         {"line": 999, "phrase": "yok", "note": "geçersiz satır"}]}]}
    if "List the most useful synonyms" in prompt:
        head = re.search(r'word or phrase "(.+?)"', prompt).group(1)
        return {"senses": [{"pos": "noun", "tr": "masa", "synonyms": [
            {"word": "Schreibtisch", "article": "der", "tr": "çalışma masası", "note": "Ofiste.", "example": "Der Schreibtisch ist neu.", "exampleTr": "Masa yeni."},
            {"word": head, "article": "der", "tr": "aynısı", "note": "", "example": "", "exampleTr": ""},
            {"word": "Pult", "article": "das", "tr": "kürsü", "note": "Okulda.", "example": "", "exampleTr": ""},
            {"word": "pult", "article": "das", "tr": "tekrar", "note": "", "example": "", "exampleTr": ""}]}]}
    return {}


# ----- 4. Sahte YouTube transkriptleri -----
from youtube_transcript_api import (  # noqa: E402  (ortam ayarlandıktan sonra)
    FetchedTranscript, FetchedTranscriptSnippet, IpBlocked, TranscriptsDisabled)

VIDEOS = {
    "enTestVid01": ("en", [
        "Hello everyone, welcome back to the channel.",
        "Today we are going to pick up some new words.",
        "I gave up smoking last year, and it was hard.",
        "The weather was beautiful, so we decided to walk.",
        "Scientists discovered an extraordinary phenomenon.",
    ]),
    "esTestVid01": ("es", [
        "Hola a todos, bienvenidos al canal.",
        "Hoy vamos a hablar de la estación de tren.",
        "Mi hermana vive en Sevilla con su familia.",
        "El tiempo era precioso y decidimos caminar.",
    ]),
    "deTestVid01": ("de", [
        "Hallo zusammen, willkommen zurück auf dem Kanal.",
        "Heute sprechen wir über den Bahnhof und die Straße.",
        "Ich glaube, meine Schwester wohnt in Hamburg.",
        "Guck mal, das Wetter ist wirklich schön.",
        "Wir sind gestern mit dem Fahrrad gefahren.",
        "Das war echt awesome.",
    ]),
    "deTestVid02": ("de", ["Das Wetter ist heute schön.", "Wir wohnen in einer großen Straße."]),
}


class FakeYouTube:
    def __init__(self):
        self.fetched = []

    def fetch(self, video_id, languages=("en",)):
        self.fetched.append((video_id, tuple(languages)))
        if video_id == "noSubsVid01":
            raise TranscriptsDisabled(video_id)
        if video_id == "blockedVid1":
            raise IpBlocked(video_id)
        lang, lines = VIDEOS[video_id]
        assert lang in languages, f"{video_id} için istenen altyazı dilleri {languages}"
        snippets = [FetchedTranscriptSnippet(text=text, start=index * 4.0, duration=3.5) for index, text in enumerate(lines)]
        return FetchedTranscript(snippets=snippets, video_id=video_id, language=lang, language_code=lang, is_generated=False)


NET = FakeNet()
YOUTUBE = FakeYouTube()
urllib.request.urlopen = NET.urlopen

from backend import app as app_module, gemini, transcripts  # noqa: E402

gemini.KEY_FILE = TMP / "anahtar-yok.txt"  # gerçek gemini_key.txt asla okunmasın
gemini.RETRY_WAIT = 0
transcripts.transcript_api = YOUTUBE
app = app_module.app


@atexit.register
def _cleanup():
    shutil.rmtree(TMP, ignore_errors=True)


class ApiTest(unittest.TestCase):
    """Ortak test sınıfı: Flask test istemcisi + her testten önce temiz sahte ağ."""

    def setUp(self):
        NET.reset()
        self.client = app.test_client()

    def tearDown(self):
        self.assertEqual(NET.unexpected, [], "testte beklenmeyen bir adrese istek gitti")

    def get(self, path, status=200, **params):
        response = self.client.get(path, query_string=params)
        self.assertEqual(response.status_code, status, response.get_data(as_text=True)[:400])
        return response.get_json(silent=True)

    def post(self, path, body, status=200, **params):
        response = self.client.post(path, json=body, query_string=params)
        self.assertEqual(response.status_code, status, response.get_data(as_text=True)[:400])
        return response.get_json(silent=True)

    def static_json(self, path):
        response = self.client.get(path)
        try:
            self.assertEqual(response.status_code, 200, path)
            return response.get_json()
        finally:
            response.close()

    @staticmethod
    def cached(name):
        """Önbellek deposunda (geçici klasör) yazılmış dosya."""
        path = CACHE / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
