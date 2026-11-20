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
- /api/lesson?topic=<konu> ve /api/lesson/quiz : Gramer bölümü (lessons.py): konu anlatımı ve alıştırma.
- /api/wordbank : Pekiştir sayfası için seviyeli kelime haznesi (wordbank.py).
- /api/ielts/* : IELTS bölümü (ielts.py): Reading/Listening setleri, Writing konusu ve değerlendirmesi, Speaking soruları.
- /api/languages : öğrenilebilen diller (languages.py). Bütün /api/* istekleri ?lang= alır (yoksa İngilizce).
"""

import hmac
from pathlib import Path
from urllib.error import HTTPError

from flask import Flask, Response, abort, g, jsonify, request, send_from_directory

from . import ielts, languages, lessons, wordbank
from .config import APP_PASSWORD, APP_PUBLIC, ON_VERCEL, WEB_DIR
from .gemini import GeminiError
from .grammar import GrammarError, analyze_grammar
from .ipa import WORD, prepare_ipa, syllabify, token_to_ipa
from .transcripts import (
    TranscriptError,
    clean,
    extract_video_id,
    find_occurrences,
    get_transcript,
    load_transcripts,
    transcript_cache,
)
from .vocab import build_vocab, translate_sentence

STATIC_TYPES = {".html", ".css", ".js", ".json", ".png", ".jpg", ".svg", ".ico", ".webp"}  # .json: yalnızca web/data/ (önbellekler web/ dışında)

app = Flask(__name__, static_folder=None)
app.json.ensure_ascii = False  # IPA sembolleri JSON'da okunur kalsın

vocab_cache = {}  # video id -> kelime listesi
load_transcripts()  # daha önce açılmış videoların transkriptleri (kelime araması için)


# ===== Giriş şifresi =====
# İnternete açılınca (Vercel) adresi bulan herkes Gemini kotasını ve çeviri sınırını harcayabilir.
# APP_PASSWORD verilirse her istek şifre ister (HTTP Basic: kullanıcı adı önemsiz). Tarayıcı şifreyi bir kez sorar,
# sonra sayfaların fetch istekleri de onu kendiliğinden gönderir.

def password_ok():
    auth = request.authorization
    given = (auth.password or "") if auth and auth.type == "basic" else ""
    return hmac.compare_digest(given.encode("utf-8"), APP_PASSWORD.encode("utf-8"))


@app.before_request
def require_password():
    if APP_PASSWORD:
        if not password_ok():
            return Response("Kelime Defteri: şifre gerekli.", 401, {
                "WWW-Authenticate": 'Basic realm="Kelime Defteri", charset="UTF-8"',
                "Content-Type": "text/plain; charset=utf-8",
            })
    elif ON_VERCEL and not APP_PUBLIC:
        # Şifresiz yayın kazara olmasın: Vercel'de ya APP_PASSWORD ya da bilerek APP_PUBLIC=1 verilmeli.
        return Response("Kelime Defteri: Vercel ayarlarında APP_PASSWORD ortam değişkenini tanımla "
                        "(ya da herkese açık olsun istiyorsan APP_PUBLIC=1).", 503, {"Content-Type": "text/plain; charset=utf-8"})
    return None


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


@app.before_request
def choose_language():
    """Her API isteği çalışılan dili ?lang= ile taşır (web/js/lang.js apiUrl ekler). Verilmezse İngilizce.
    Seçilen dil g.lang içinde durur; dile özgü kodlar oradan okur."""
    if not request.path.startswith("/api/"):
        return None
    code = languages.resolve(request.args.get("lang"))
    if code is None:
        return error("Bu dil henüz desteklenmiyor.", 400)
    g.lang = code
    return None


@app.get("/api/languages")
def language_list():
    return jsonify({"default": languages.DEFAULT, "languages": languages.public_list()})


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


# ===== IELTS bölümü =====

def ielts_call(action):
    """IELTS uçlarının ortak hata biçimi: {"error": mesaj, "code": tür}."""
    try:
        return jsonify(action())
    except GeminiError as exc:
        return jsonify({"error": exc.message, "code": exc.code}), exc.status
    except TranscriptError as exc:
        return jsonify({"error": exc.message, "code": "transcript"}), exc.status


def body_value(name, default=""):
    data = request.get_json(silent=True)
    return data.get(name, default) if isinstance(data, dict) else default


def body_task():
    task = body_value("task", 0)
    return task if isinstance(task, int) and not isinstance(task, bool) else 0


def body_level():
    """Zorluk seviyesi (bant 5-8); verilmezse ielts.py varsayılanı kullanır."""
    level = body_value("level", 0)
    return level if isinstance(level, int) and not isinstance(level, bool) else 0


@app.post("/api/ielts/reading")
def ielts_reading():
    """Yeni Reading seti üretir: {"module": "academic" | "general", "level": 5-8}."""
    return ielts_call(lambda: ielts.make_reading(str(body_value("module")), body_level()))


@app.post("/api/ielts/listening")
def ielts_listening():
    """Bir videonun transkriptinden dinleme soruları: {"url": youtube linki ya da video id}."""
    def action():
        video_id = extract_video_id(str(body_value("url")))
        if not video_id:
            raise GeminiError("Bu geçerli bir YouTube linki değil.", 400, "bad_request")
        data = get_transcript(video_id)
        return ielts.make_listening(video_id, data.get("title", ""), data["lines"], body_level())
    return ielts_call(action)


@app.post("/api/ielts/writing-task")
def ielts_writing_task():
    """Writing konusu: {"module", "task": 1 | 2}."""
    return ielts_call(lambda: ielts.make_writing_task(str(body_value("module")), body_task(), body_level()))


@app.post("/api/ielts/writing-review")
def ielts_writing_review():
    """Writing cevabının tahmini değerlendirmesi: {"module", "task", "prompt", "essay"}."""
    return ielts_call(lambda: ielts.review_writing(
        str(body_value("module")), body_task(), body_value("prompt"), body_value("essay"), body_value("target", None)))


@app.post("/api/ielts/speaking")
def ielts_speaking():
    """Speaking Part 1-2-3 soruları."""
    return ielts_call(lambda: ielts.make_speaking(body_level()))


@app.post("/api/ielts/grammar")
def ielts_grammar():
    """Gramer tekrarı alıştırması: {"topic": konu anahtarı, "level": 5-8}."""
    return ielts_call(lambda: ielts.make_grammar(str(body_value("topic")), body_level()))


@app.get("/api/ielts/sets")
def ielts_sets():
    """Kayıtlı setlerin listesi: ?kind=reading | listening."""
    return jsonify({"sets": ielts.list_sets(request.args.get("kind", ""))})


@app.get("/api/ielts/set")
def ielts_set():
    """Kayıtlı tek set: ?kind=&id=."""
    data = ielts.load_set(request.args.get("kind", ""), request.args.get("id", ""))
    if data is None:
        return error("Set bulunamadı.", 404)
    return jsonify(data)


@app.get("/api/ielts/videos")
def ielts_videos():
    """Daha önce açılmış (transkripti kayıtlı) videolar: Listening için seçim listesi."""
    videos = [{"videoId": data["videoId"], "title": data.get("title", ""), "lines": len(data["lines"])}
              for data in transcript_cache.values()]
    return jsonify({"videos": sorted(videos, key=lambda video: video["title"].lower())})


# ===== Gramer bölümü (genel İngilizce) =====

@app.get("/api/lesson")
def lesson():
    """Konunun ayrıntılı anlatımı: ?topic=<anahtar>[&fresh=1]. İlk açılışta Gemini üretir, sonra önbellekten gelir."""
    return ielts_call(lambda: lessons.get_lesson(request.args.get("topic", ""), request.args.get("fresh") == "1"))


@app.post("/api/lesson/quiz")
def lesson_quiz():
    """Konunun alıştırması: {"topic": anahtar}."""
    return ielts_call(lambda: lessons.make_quiz(str(body_value("topic"))))


# ===== Pekiştir sayfası: seviyeli kelime haznesi =====

@app.get("/api/wordbank/sources")
def word_bank_sources():
    """İçe aktarılmış kelime listesi var mı: {"name": ad, "levels": {"B2": adet, ...}}."""
    return jsonify(wordbank.list_sources())


@app.post("/api/wordbank")
def word_bank():
    """Seviyeden rastgele kelimeler: {"level": "B1", "count": 12, "exclude": ["bilinen", "kelimeler"]}."""
    def action():
        count = body_value("count", 12)
        exclude = body_value("exclude", [])
        return wordbank.get_words(
            str(body_value("level")),
            count if isinstance(count, int) and not isinstance(count, bool) else 12,
            [word for word in exclude if isinstance(word, str)][:3000] if isinstance(exclude, list) else [],
            str(body_value("topic", "") or ""),  # kelime konusu (web/data/kelime-konulari.json); boş = karışık
        )
    return ielts_call(action)
