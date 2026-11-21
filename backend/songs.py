"""Şarkı sözleri: Spotify linki → şarkı adı (oEmbed) → LRCLIB'den zaman damgalı söz (LRC) → satırlar.

Spotify'ın kendi API'si anahtar ister; oEmbed anahtarsızdır ve yalnızca şarkı adı ile kapak resmi verir.
Sözler LRCLIB'den gelir (anahtarsız, açık servis). Hata olursa SongError (mesaj + HTTP kodu).
"""

import json
import re
import types
import urllib.error
import urllib.request
from urllib.parse import quote, urlparse

from wordfreq import zipf_frequency

from . import languages
from .transcripts import SONG_ID, build_lines, cache_for, clean, save_transcript  # noqa: F401 (SONG_ID: dışarıya songs.SONG_ID olarak da açık)

SPOTIFY_HOST = "open.spotify.com"
TRACK_ID = re.compile(r"^[A-Za-z0-9]{22}$")
INTL_SEGMENT = re.compile(r"^intl-[A-Za-z]{2,3}(-[A-Za-z]+)?$")  # /intl-tr/track/... gibi bölge öneki

LRC_STAMP = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
HAS_LETTER = re.compile(r"[^\W\d_]")  # ♪, ..., yalnızca rakam/noktalama satırlarını ayıklamak için
MAX_LINE_SECONDS = 8.0   # LRC'de satır bitişi yok: sonraki satıra kadar, en çok bu kadar
LAST_LINE_SECONDS = 4.0
DURATION_TOLERANCE = 3.0  # Spotify süresi ile LRCLIB süresi arasında kabul edilen fark (sn)
MAX_CANDIDATES = 8

USER_AGENT = "KelimeDefteri/1.0"


class SongError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.message = message
        self.status = status


# ===== Spotify linki =====

def parse_url(link):
    """Kullanıcının yapıştırdığı metni URL olarak ayrıştırır; bozuksa ('https://[' gibi) None."""
    try:
        return urlparse(link if "://" in link else "https://" + link)
    except ValueError:
        return None


def extract_track_id(link):
    """Spotify şarkı linkinden 22 karakterlik şarkı kimliğini çıkarır; şarkı linki değilse None."""
    link = (link or "").strip()
    if link.lower().startswith("spotify:track:"):
        candidate = link.split(":", 2)[2]
        return candidate if TRACK_ID.match(candidate) else None
    parsed = parse_url(link)
    if parsed is None or (parsed.hostname or "").lower() != SPOTIFY_HOST:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if parts and INTL_SEGMENT.match(parts[0]):
        parts = parts[1:]
    if len(parts) >= 2 and parts[0] == "track" and TRACK_ID.match(parts[1]):
        return parts[1]
    return None


def is_spotify_link(link):
    """Spotify'a ait mi (albüm/oynatma listesi de olabilir; şarkı mı olduğu extract_track_id ile ayrılır)."""
    link = (link or "").strip()
    if link.lower().startswith("spotify:"):
        return True
    parsed = parse_url(link)
    return parsed is not None and (parsed.hostname or "").lower() == SPOTIFY_HOST


def song_id(track_id):
    return "sp:" + track_id


# ===== LRC =====

def parse_lrc(text):
    """LRC metni → [(başlangıç, süre, metin)], zamana göre sıralı. Sözsüz satırlar (♪, boş) atılır."""
    stamped = []
    for raw in (text or "").splitlines():
        stamps = LRC_STAMP.findall(raw)
        if not stamps:
            continue  # [ar:...] gibi künye satırları ya da damgasız satır
        line = clean(LRC_STAMP.sub("", raw))
        if not HAS_LETTER.search(line):
            continue
        for minutes, seconds in stamps:
            stamped.append((int(minutes) * 60 + float(seconds), line))
    stamped.sort(key=lambda row: row[0])

    rows = []
    for index, (start, line) in enumerate(stamped):
        if index + 1 < len(stamped):
            length = min(stamped[index + 1][0] - start, MAX_LINE_SECONDS)
        else:
            length = LAST_LINE_SECONDS
        rows.append((start, length, line))
    return rows


# ===== Dış servisler =====

def request_json(url, timeout, unreachable, not_found=None):
    """GET + JSON. Ağ/biçim hatası → SongError(unreachable, 502); 404 ve not_found verilmişse → SongError(not_found, 404)."""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404 and not_found:
            raise SongError(not_found, 404) from error
        raise SongError(unreachable, 502) from error
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise SongError(unreachable, 502) from error


def song_meta(track_id):
    """Spotify oEmbed: {title, thumbnail}."""
    track_url = f"https://{SPOTIFY_HOST}/track/{track_id}"
    data = request_json(f"https://{SPOTIFY_HOST}/oembed?url={quote(track_url, safe='')}", 8,
                        "Spotify'a ulaşılamadı.", "Bu Spotify şarkısı bulunamadı.")
    title = clean(str(data.get("title") or ""))
    if not title:
        raise SongError("Spotify şarkı adını vermedi.", 502)
    return {"title": title, "thumbnail": data.get("thumbnail_url") or ""}


LYRICS_DOWN = "Şarkı sözleri servisine ulaşılamadı."


def candidate_of(entry):
    """LRCLIB kaydı → bizim aday biçimi."""
    return {
        "id": int(entry["id"]),
        "artist": str(entry.get("artistName") or ""),
        "track": str(entry.get("trackName") or ""),
        "album": str(entry.get("albumName") or ""),
        "duration": float(entry.get("duration") or 0),
        "synced": str(entry.get("syncedLyrics") or ""),
    }


def find_lyrics(title):
    """LRCLIB'de şarkı adıyla arar; yalnızca senkronlu sözü olanlar (en çok 8, tekrarlar tek)."""
    data = request_json(f"https://lrclib.net/api/search?track_name={quote(title, safe='')}", 10, LYRICS_DOWN)
    if not isinstance(data, list):
        raise SongError(LYRICS_DOWN, 502)
    result, seen = [], set()
    for entry in data:
        if not isinstance(entry, dict) or entry.get("instrumental") or not str(entry.get("syncedLyrics") or "").strip():
            continue
        try:
            candidate = candidate_of(entry)
        except (KeyError, TypeError, ValueError):
            continue
        key = (candidate["artist"].lower(), candidate["track"].lower(), round(candidate["duration"]))
        if key in seen:
            continue
        seen.add(key)
        result.append(candidate)
        if len(result) >= MAX_CANDIDATES:
            break
    return result


def fetch_lyrics(lrclib_id):
    """Tek LRCLIB kaydı (aday biçiminde). Yoksa ya da senkronlu söz yoksa SongError 404."""
    missing = "Bu sürüm için senkronlu söz bulunamadı."
    data = request_json(f"https://lrclib.net/api/get/{int(lrclib_id)}", 10, LYRICS_DOWN, missing)
    if not isinstance(data, dict):
        raise SongError(LYRICS_DOWN, 502)
    try:
        candidate = candidate_of(data)
    except (KeyError, TypeError, ValueError) as error:
        raise SongError(LYRICS_DOWN, 502) from error
    if data.get("instrumental") or not candidate["synced"].strip():
        raise SongError(missing, 404)
    return candidate


# ===== Aday seçimi =====

def first_artist(name):
    """LRCLIB bazen 'Ad, Ad' yazar: ilk sanatçı, küçük harf."""
    return name.split(",")[0].strip().lower()


def choose_candidate(candidates, duration):
    """Kullanıcıya sormadan seçilebilen tek aday varsa onu, yoksa None döndürür.

    Birden çok sanatçı → belirsiz. Tek sanatçıda: Spotify süresi biliniyorsa ±3 sn içindeki en yakın;
    bilinmiyorsa bütün sürelerin 3 sn içinde olması gerekir (aynı sözün farklı kayıtları), ilki alınır.
    """
    if not candidates or len({first_artist(c["artist"]) for c in candidates}) > 1:
        return None
    if duration is None:
        durations = [c["duration"] for c in candidates]
        return candidates[0] if max(durations) - min(durations) <= DURATION_TOLERANCE else None
    near = [c for c in candidates if abs(c["duration"] - duration) <= DURATION_TOLERANCE]
    return min(near, key=lambda c: abs(c["duration"] - duration)) if near else None


def public_candidates(candidates):
    """Tarayıcıya gidecek adaylar: söz metni (synced) çıkarılmış."""
    return [{key: value for key, value in c.items() if key != "synced"} for c in candidates]


# ===== Şarkıyı transkript hattına bağlama =====

MIN_LANGUAGE_SHARE = 0.5  # sözdeki farklı kelimelerin en az bu kadarı seçili dile ait sayılmalı
SONG_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*")


def display_artist(name):
    """LRCLIB bazen 'Ad, Ad' yazar: aynı adın tekrarı tek yazılır."""
    parts = [part.strip() for part in name.split(",") if part.strip()]
    return parts[0] if parts and len({part.lower() for part in parts}) == 1 else name.strip()


def language_share(lines, lang):
    """Sözdeki farklı kelimelerin (en az 2 harfli) seçili dile ait olanlarının oranı; kelime yoksa 1.0.
    Bir kelime, wordfreq sıklığı seçili dilde öteki kayıtlı dillerin hepsinden aşağı değilse (ve sıfır değilse) o dile aittir:
    kurallı okunuşlu paketler her dilin kelimesine okunuş verdiğinden okunuş dil işareti sayılmaz."""
    tokens = {token.lower() for line in lines for token in SONG_WORD.findall(line["text"]) if len(token) >= 2}
    if not tokens:
        return 1.0
    others = [code for code in languages.LANGUAGES if code != lang]
    own = 0
    for token in tokens:
        mine = zipf_frequency(token, lang)
        if mine > 0 and all(mine >= zipf_frequency(token, other) for other in others):
            own += 1
    return own / len(tokens)


def language_warning(lines, lang):
    """Söz seçili dilde görünmüyorsa True (arayüz: "Bu şarkı ... görünmüyor"; yanıt yine döner)."""
    return language_share(lines, lang) < MIN_LANGUAGE_SHARE


def get_song(track_id, candidate, meta, lang):
    """Seçilen LRCLIB kaydından şarkıyı kurar; transkript önbelleğine ve depoya yazar (varsa üstüne).
    Dönen yanıt /api/transcript ile aynı biçimdedir (videoId, language, generated, lines) + şarkı alanları."""
    rows = parse_lrc(candidate["synced"])
    if not rows:
        raise SongError("Bu sürümün sözleri okunamadı.", 404)
    snippets = [types.SimpleNamespace(start=start, duration=length, text=text) for start, length, text in rows]
    lines = build_lines(snippets, lang)
    artist = display_artist(candidate["artist"])
    track = candidate["track"] or meta["title"]
    data = {
        "videoId": song_id(track_id),
        "kind": "song",
        "title": f"{artist} – {track}" if artist else track,
        "artist": artist,
        "track": track,
        "thumbnail": meta.get("thumbnail", ""),
        "lrclibId": candidate["id"],
        "language": lang,
        "generated": False,
        "languageWarning": language_warning(lines, lang),
        "lines": lines,
    }
    cache_for(lang)[data["videoId"]] = data
    save_transcript(data, lang)
    return data
