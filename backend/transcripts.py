"""
YouTube transkriptleri: video id çözme, altyazıyı cümlelere bölme, diskte saklama
ve bir kelimenin kayıtlı videolarda geçtiği yerleri bulma.

Her şey çalışılan dile göre ayrılır (lang: "en", "es"...). Aynı video iki dilde ayrı transkript olarak saklanır:
İngilizce eski yerinde (transcripts/<id>.json), diğer diller kendi klasöründe (es/transcripts/<id>.json).
Dile özgü parçalar (kelime deseni, IPA, çekimler) pack(lang) ile seçilir.
"""

import html
import json
import logging
import os
import re
import threading
import urllib.request
from urllib.parse import parse_qs, quote, urlparse

from lemminflect import getAllInflections, getAllLemmas
from youtube_transcript_api import (
    CouldNotRetrieveTranscript,
    InvalidVideoId,
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)
from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig

from . import german, ipa, languages, spanish, storage
from .config import ON_VERCEL
from .ipa import WORD

log = logging.getLogger("kelime-defteri")



PACKS = {"es": spanish, "de": german}  # İngilizce dışındaki dil paketleri (aynı arayüz: WORD, word_to_ipa, build_vocab...)


def pack(lang):
    """Dile özgü telaffuz ve kelime araçları: WORD deseni, prepare_ipa, token_to_ipa, word_to_ipa, syllables."""
    return PACKS.get(lang, ipa)


def proxy_config():
    """YouTube bulut sunucularının (Vercel gibi) IP'lerini sık engeller. Proxy verilirse istekler onun üzerinden gider:
    WEBSHARE_PROXY_USERNAME + WEBSHARE_PROXY_PASSWORD (dönen konut IP'leri) ya da YT_PROXY_URL (http://kullanici:sifre@sunucu:port)."""
    user = os.environ.get("WEBSHARE_PROXY_USERNAME", "")
    password = os.environ.get("WEBSHARE_PROXY_PASSWORD", "")
    if user and password:
        return WebshareProxyConfig(proxy_username=user, proxy_password=password)
    url = os.environ.get("YT_PROXY_URL", "")
    if url:
        return GenericProxyConfig(http_url=url, https_url=url)
    return None


transcript_api = YouTubeTranscriptApi(proxy_config=proxy_config())
transcript_cache = {}  # İngilizce: video id -> hazır yanıt (açılışta cache/transcripts klasöründen de dolar)
caches = {"en": transcript_cache}  # dil -> {video id -> yanıt}; diğer diller ilk istendiğinde depodan yüklenir
caches_lock = threading.Lock()


def folder(lang):
    return languages.storage_name(lang, "transcripts")


def cache_for(lang):
    with caches_lock:
        if lang not in caches:
            caches[lang] = {}
            for data in storage.read_folder(folder(lang)):
                if valid_transcript(data):
                    caches[lang].setdefault(data["videoId"], data)
        return caches[lang]


# ===== YouTube linkinden video id =====

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(link):
    link = link.strip()
    if VIDEO_ID.match(link):
        return link

    if "://" not in link:
        link = "https://" + link
    parsed = urlparse(link)
    host = parsed.netloc.lower().removeprefix("www.").removeprefix("m.")
    parts = [p for p in parsed.path.split("/") if p]

    candidate = None
    if host == "youtu.be" and parts:
        candidate = parts[0]
    elif host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        if parts and parts[0] == "watch":
            candidate = parse_qs(parsed.query).get("v", [None])[0]
        elif len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v"):
            candidate = parts[1]

    if candidate and VIDEO_ID.match(candidate):
        return candidate
    return None


# ===== Transkripti cümlelere bölme =====

SENTENCE_END = re.compile(r"[.?!][\"')\]]*$")
MAX_WORDS = 40  # noktalama olmadan uzayan cümleleri böl


def clean(text):
    text = html.unescape(text).replace("\n", " ")
    return re.sub(r"\s+", " ", text).strip()


def build_lines(snippets, lang="en"):
    pieces = [(s.start, s.duration, clean(s.text)) for s in snippets]
    pieces = [p for p in pieces if p[2]]
    if not pieces:
        return []

    # Otomatik altyazılarda noktalama olmaz; o zaman her parça bir satır
    ended = sum(1 for _, _, text in pieces if SENTENCE_END.search(text))
    has_punctuation = ended >= max(2, len(pieces) // 10)

    lines = []
    current = None
    for start, duration, text in pieces:
        if current is None:
            current = {"start": start, "end": start + duration, "tokens": []}
        current["tokens"].extend(text.split(" "))
        current["end"] = start + duration

        finished = (
            not has_punctuation
            or SENTENCE_END.search(text)
            or len(current["tokens"]) >= MAX_WORDS
        )
        if finished:
            lines.append(current)
            current = None
    if current:
        lines.append(current)

    speech = pack(lang)
    speech.prepare_ipa([t for line in lines for t in line["tokens"]])

    result = []
    for line in lines:
        words = [{"text": t, "ipa": speech.token_to_ipa(t)} for t in line["tokens"]]
        result.append({
            "start": round(line["start"], 2),
            "end": round(line["end"], 2),
            "text": " ".join(line["tokens"]),
            "words": words,
        })
    return result


# ===== Transkripti getirme =====

class TranscriptError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.message = message
        self.status = status


def get_transcript(video_id, lang="en"):
    """Transkripti getirir (önbellekten ya da YouTube'dan). Hata olursa TranscriptError."""
    cache = cache_for(lang)
    if video_id in cache:
        return cache[video_id]
    stored = storage.read(f"{folder(lang)}/{video_id}.json")  # başka bir sunucu kopyası (Vercel) kaydetmiş olabilir
    if valid_transcript(stored):
        cache[video_id] = stored
        return stored

    try:
        fetched = transcript_api.fetch(video_id, languages=languages.info(lang)["transcript"])
    except TranscriptsDisabled:
        raise TranscriptError("Bu videoda altyazı/transkript kapalı.", 404)
    except NoTranscriptFound:
        raise TranscriptError(f"Bu videonun {languages.info(lang)['name']} transkripti yok.", 404)
    except (VideoUnavailable, InvalidVideoId):
        raise TranscriptError("Video bulunamadı ya da erişilemiyor.", 404)
    except (RequestBlocked, IpBlocked):
        if ON_VERCEL and proxy_config() is None:
            raise TranscriptError("YouTube bu sunucunun (Vercel) isteklerini engelliyor. Transkript için bir proxy ayarla "
                                  "(WEBSHARE_PROXY_USERNAME/PASSWORD ya da YT_PROXY_URL) ya da uygulamayı yerelde çalıştır.", 503)
        raise TranscriptError("YouTube şu an istekleri engelliyor. Biraz sonra tekrar dene.", 503)
    except CouldNotRetrieveTranscript as exc:
        log.warning("Transkript alınamadı: %s", exc)
        raise TranscriptError("Transkript alınamadı.", 502)

    data = {
        "videoId": video_id,
        "title": fetch_title(video_id),
        "language": fetched.language,
        "generated": fetched.is_generated,
        "lines": build_lines(fetched.snippets, lang),
    }
    cache[video_id] = data
    save_transcript(data, lang)
    return data


# ===== Transkriptleri diskte saklama + kelimenin videolarda geçtiği yerler =====

def fetch_title(video_id):
    """Videonun başlığı (YouTube oEmbed; anahtar gerekmez). Alınamazsa boş."""
    url = "https://www.youtube.com/oembed?format=json&url=" + quote(f"https://www.youtube.com/watch?v={video_id}", safe="")
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return str(json.loads(response.read().decode("utf-8")).get("title", ""))[:200]
    except Exception:
        return ""


def valid_transcript(data):
    return isinstance(data, dict) and bool(VIDEO_ID.match(str(data.get("videoId", "")))) and isinstance(data.get("lines"), list)


def save_transcript(data, lang="en"):
    storage.write(f"{folder(lang)}/{data['videoId']}.json", data)


def load_transcripts():
    """Sunucu açılırken daha önce kaydedilmiş İngilizce transkriptleri belleğe alır (storage: disk ya da Redis).
    Diğer diller ilk istendiklerinde yüklenir (cache_for)."""
    for data in storage.read_folder(folder("en")):
        if valid_transcript(data):
            transcript_cache.setdefault(data["videoId"], data)


def word_forms(word):
    """Kelimenin bütün çekimleri: run -> {run, runs, ran, running}. Aranan çekimliyse (running) köküne inilir."""
    forms = {word}
    lemmas = {word}
    for group in getAllLemmas(word).values():
        lemmas.update(lemma.lower() for lemma in group)
    for lemma in lemmas:
        forms.add(lemma)
        for group in getAllInflections(lemma).values():
            forms.update(form.lower() for form in group)
    return forms


MAX_HITS_PER_VIDEO = 6
MAX_VIDEOS = 30


def find_occurrences(query, lang="en"):
    """Kayıtlı transkriptlerde kelimeyi (ya da "pick up" gibi ifadeyi) arar.
    İlk kelimenin çekimleri de sayılır (picked up). Araya kelime giren kullanımlar (pick it up) bulunmaz."""
    pattern = pack(lang).WORD
    parts = [p.lower() for p in pattern.findall(query.replace("’", "'"))]
    if not parts:
        return None
    cache = cache_for(lang)
    if lang in PACKS:
        first_forms = PACKS[lang].word_forms(parts[0], (line["text"] for data in list(cache.values()) for line in data["lines"]))
    else:
        first_forms = word_forms(parts[0])
    rest = parts[1:]
    videos = []
    total = 0
    for data in list(cache.values()):
        hits = []
        count = 0
        for index, line in enumerate(data["lines"]):
            tokens = [(m.group().lower(), m.start(), m.end()) for m in pattern.finditer(line["text"].replace("’", "'"))]
            for i, (token, begin, _) in enumerate(tokens):
                if token not in first_forms:
                    continue
                if [t[0] for t in tokens[i + 1:i + 1 + len(rest)]] != rest:
                    continue
                count += 1
                if len(hits) < MAX_HITS_PER_VIDEO and (not hits or hits[-1]["line"] != index):
                    end = tokens[i + len(rest)][2]
                    hits.append({"line": index, "start": line["start"], "text": line["text"], "span": [begin, end]})
        if count:
            total += count
            videos.append({"videoId": data["videoId"], "title": data.get("title", ""), "count": count, "hits": hits})
    videos.sort(key=lambda video: -video["count"])
    return {
        "word": " ".join(parts),
        "forms": sorted(first_forms),
        "total": total,
        "searched": len(cache),
        "videos": videos[:MAX_VIDEOS],
    }
