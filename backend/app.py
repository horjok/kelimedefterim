"""
Kelime Defteri Flask uygulaması.

- web/ klasöründeki HTML/CSS/JS dosyalarını http://localhost:8000 adresinden sunar.
- /api/transcript?url=<youtube linki> : videonun İngilizce transkriptini
  cümlelere böler ve her kelimenin IPA (fonetik) telaffuzunu ekler.
- /api/vocab?url=<youtube linki> : videodaki kelimeler, seviyelere göre.
- /api/translate?text=<cümle> : tek bir cümlenin Türkçe çevirisi.
- /api/grammar?url=<youtube linki> : videodaki gramer konuları (Gemini API, grammar.py).
- /api/syllables?word=<kelime> : kelimenin heceleri (IPA), "sondan başa" telaffuz alıştırması için.
- /api/occurrences?word=<kelime> : kelimenin daha önce açılmış videolarda geçtiği cümleler.
"""

from pathlib import Path
from urllib.error import HTTPError

from flask import Flask, abort, jsonify, request, send_from_directory

from .config import WEB_DIR
from .grammar import GrammarError, analyze_grammar
from .ipa import WORD, prepare_ipa, syllabify, token_to_ipa
from .transcripts import (
    TranscriptError,
    clean,
    extract_video_id,
    find_occurrences,
    get_transcript,
    load_transcripts,
)
from .vocab import build_vocab, translate_sentence

STATIC_TYPES = {".html", ".css", ".js", ".png", ".jpg", ".svg", ".ico", ".webp"}

app = Flask(__name__, static_folder=None)
app.json.ensure_ascii = False  # IPA sembolleri JSON'da okunur kalsın

vocab_cache = {}  # video id -> kelime listesi
load_transcripts()  # daha önce açılmış videoların transkriptleri (kelime araması için)


# ===== Statik dosyalar =====

@app.get("/")
def home():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/<path:filename>")
def static_file(filename):
    # Sadece site dosyalarını sun (server.py gibi dosyalar dışarı açılmasın)
    if Path(filename).suffix.lower() not in STATIC_TYPES:
        abort(404)
    return send_from_directory(WEB_DIR, filename)


# ===== API =====

def error(message, status):
    return jsonify({"error": message}), status


@app.get("/api/transcript")
def transcript():
    video_id = extract_video_id(request.args.get("url", ""))
    if not video_id:
        return error("Bu geçerli bir YouTube linki değil.", 400)
    try:
        return jsonify(get_transcript(video_id))
    except TranscriptError as exc:
        return error(exc.message, exc.status)


@app.get("/api/vocab")
def vocabulary():
    """Videodaki kelimeler: seviyelere göre (A1...C2) + phrasal verb'ler, Türkçe anlamlarıyla."""
    video_id = extract_video_id(request.args.get("url", ""))
    if not video_id:
        return error("Bu geçerli bir YouTube linki değil.", 400)
    if video_id in vocab_cache:
        return jsonify(vocab_cache[video_id])
    try:
        lines = get_transcript(video_id)["lines"]
    except TranscriptError as exc:
        return error(exc.message, exc.status)

    data = build_vocab(lines, token_to_ipa, prepare_ipa)
    if data["translationError"] is None:  # eksik çeviriyle önbelleğe alma, sonra tekrar denensin
        vocab_cache[video_id] = data
    return jsonify(data)


@app.get("/api/grammar")
def grammar():
    """Videodaki gramer konuları (Gemini API): {"model", "topics": [...], "truncated"}.
    Hata: {"error": mesaj, "code": "no_key" | "bad_key" | "quota" | ...}."""
    video_id = extract_video_id(request.args.get("url", ""))
    if not video_id:
        return error("Bu geçerli bir YouTube linki değil.", 400)
    try:
        lines = get_transcript(video_id)["lines"]
    except TranscriptError as exc:
        return error(exc.message, exc.status)
    try:
        return jsonify(analyze_grammar(video_id, lines))
    except GrammarError as exc:
        return jsonify({"error": exc.message, "code": exc.code}), exc.status


@app.get("/api/syllables")
def syllable_list():
    """Kelimenin heceleri: {"word", "syllables": [{"ipa", "stress": 0|1|2}]}. stress: 1 ana vurgu, 2 ikincil."""
    word = clean(request.args.get("word", "")).lower().replace("’", "'")[:40]
    if not WORD.fullmatch(word):
        return error("Tek bir İngilizce kelime yaz.", 400)
    parts = syllabify(word)
    if not parts:
        return error("Bu kelimenin okunuşu sözlükte yok.", 404)
    return jsonify({"word": word, "syllables": parts})


@app.get("/api/occurrences")
def occurrences():
    """Kelimenin daha önce açılmış videolarda geçtiği cümleler:
    {"word", "forms", "total", "searched", "videos": [{"videoId", "title", "count", "hits": [{"line", "start", "text", "span"}]}]}."""
    result = find_occurrences(clean(request.args.get("word", ""))[:80])
    if result is None:
        return error("Aranacak kelime yok.", 400)
    return jsonify(result)


@app.get("/api/translate")
def translate():
    """Tek bir cümlenin Türkçe çevirisi: {"tr": "..."}. Video sayfasındaki "Çevir" düğmeleri kullanır."""
    text = clean(request.args.get("text", ""))[:600]
    if not text:
        return error("Çevrilecek metin yok.", 400)
    try:
        return jsonify({"tr": translate_sentence(text)})
    except HTTPError as exc:
        if exc.code == 429:  # Google kısa sürede çok istek geldiğini söylüyor
            return error("Çeviri servisi şu an istekleri sınırlıyor. Birkaç dakika sonra yeniden dene.", 503)
        return error(f"Çeviri servisi hata verdi (kod {exc.code}).", 502)
    except Exception as exc:  # ağ hatası, engelleme, beklenmeyen yanıt
        return error(f"Çeviri servisine ulaşılamadı ({exc.__class__.__name__}).", 502)
