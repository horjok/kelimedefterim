"""
Videodaki gramer konularını Gemini API ile çıkarır.

- Anahtar: GEMINI_API_KEY ortam değişkeni ya da proje klasöründeki gemini_key.txt dosyasının ilk satırı.
  (.txt dosyaları sunucudan dışarı açılmaz; anahtarı koda ya da not defterine yazma.)
- Model: GEMINI_MODEL ortam değişkeni, yoksa "gemini-flash-lite-latest" (Google'ın en yeni hızlı Flash-Lite modeline
  işaret eden takma ad; bu iş için ~5 sn'de yanıt veriyor). Model yoğunsa (503) ya da yanıt vermezse beklemeden
  FALLBACK_MODELS listesindeki sıradaki model denenir.
- Sonuçlar cache/grammar.json dosyasında saklanır: aynı video için API ikinci kez çağrılmaz.
"""

import json
import os
import threading
import urllib.error
import urllib.request

from .config import CACHE_DIR, KEY_FILE

CACHE_FILE = CACHE_DIR / "grammar.json"
API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Hız için asıl model Flash-Lite: 15 Kasım 2026 ölçümünde ~5 sn, kalite aynı (7 konu, bütün örnekler geçerli).
# Büyük Flash modeli (gemini-flash-latest) o gün sürekli 503/zaman aşımı veriyordu; artık son yedek.
DEFAULT_MODEL = "gemini-flash-lite-latest"
# Asıl model yoğunsa (503) ya da yanıt vermezse sırayla bunlar denenir. Google model adlarını sık değiştirir:
# biri kalkarsa (404) atlanır, GEMINI_FALLBACK_MODELS ortam değişkeniyle (virgüllü) değiştirilebilir.
FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest"]
REQUEST_TIMEOUT = 30  # bir modelin yanıtı için en çok beklenen saniye
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

MAX_LINES = 160    # çok uzun videolarda yalnızca baştaki bu kadar cümle gönderilir
MAX_CHARS = 14000  # istek metni için üst sınır
cache_lock = threading.Lock()


class GrammarError(Exception):
    """Kullanıcıya gösterilecek Türkçe mesaj + HTTP kodu + kısa hata türü."""

    def __init__(self, message, status, code):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


# ===== Anahtar ve önbellek =====

def load_key():
    """Anahtarı her istekte yeniden okur: dosyayı ekleyince sunucuyu yeniden başlatmak gerekmez."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    try:
        lines = KEY_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    return lines[0].strip() if lines else ""


def load_cache():
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


grammar_cache = load_cache()  # video id -> {"model": ..., "topics": [...]}


def save_cache():
    CACHE_FILE.parent.mkdir(exist_ok=True)
    CACHE_FILE.write_text(json.dumps(grammar_cache, ensure_ascii=False, indent=1), encoding="utf-8")


# ===== İstek =====

PROMPT = """You are an English grammar teacher for Turkish-speaking learners (around B1 level).
Below is a numbered transcript of a video. Find the 5 to 8 most useful grammar points that actually occur in it.
Prefer structures a learner can reuse (tenses, modals, conditionals, passive, relative clauses, comparatives,
gerund/infinitive, reported speech, question tags, etc.). Skip trivial points like "the verb to be".

Return ONLY a JSON object with this exact shape:
{"topics": [{
  "title": "English name of the grammar point",
  "titleTr": "Turkish name",
  "level": "one of A1, A2, B1, B2, C1, C2",
  "pattern": "short formula, e.g. have/has + V3",
  "explanation": "2-3 sentences in Turkish: when and why it is used",
  "tip": "one sentence in Turkish: a common mistake Turkish speakers make, or a memory aid",
  "examples": [{"line": 12, "phrase": "exact words copied from that line that show the structure", "note": "short Turkish note about this example"}]
}]}

Rules:
- "line" must be a line number from the transcript, and "phrase" must appear word for word in that line.
- Give 2 to 4 examples per topic, from different lines when possible.
- explanation, tip and note must be written in Turkish. title and pattern stay in English.

Transcript:
"""


def build_prompt(lines):
    rows = []
    size = 0
    for number, line in enumerate(lines[:MAX_LINES], start=1):
        row = f"{number}. {line['text']}"
        size += len(row) + 1
        if size > MAX_CHARS:
            break
        rows.append(row)
    return PROMPT + "\n".join(rows)


def call_gemini(prompt, key, model):
    body = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
    }).encode("utf-8")
    request = urllib.request.Request(API_URL.format(model=model), data=body, headers={
        "Content-Type": "application/json",
        "x-goog-api-key": key,
    })
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = json.loads(exc.read().decode("utf-8"))["error"]["message"]
        except Exception:
            pass
        if exc.code in (400, 401, 403) and "key" in detail.lower():
            raise GrammarError("Gemini anahtarı geçersiz ya da yetkisiz. gemini_key.txt dosyasındaki anahtarı kontrol et.", 502, "bad_key")
        if exc.code == 404:
            raise GrammarError(f"Gemini modeli bulunamadı: {model}. GEMINI_MODEL değerini kontrol et.", 502, "bad_model")
        if exc.code == 429:
            raise GrammarError("Gemini kotası doldu ya da çok sık istek geldi. Biraz sonra yeniden dene.", 503, "quota")
        if exc.code in (500, 503):
            raise GrammarError("Gemini şu an çok yoğun, yanıt veremedi. Bir iki dakika sonra yeniden dene.", 503, "overloaded")
        raise GrammarError(f"Gemini hata verdi (kod {exc.code}). {detail[:200]}".strip(), 502, "api_error")
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(exc, TimeoutError) or isinstance(reason, TimeoutError) or "timed out" in str(reason):
            raise GrammarError("Gemini zamanında yanıt vermedi. Bir iki dakika sonra yeniden dene.", 503, "timeout")
        raise GrammarError(f"Gemini'ye ulaşılamadı ({exc.__class__.__name__}).", 502, "network")


def model_list():
    """Denenecek modeller: önce asıl model, sonra yedekler (tekrarsız)."""
    main = os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    extra = os.environ.get("GEMINI_FALLBACK_MODELS", "")
    fallbacks = [name.strip() for name in extra.split(",") if name.strip()] if extra.strip() else FALLBACK_MODELS
    return list(dict.fromkeys([main, *fallbacks]))


def ask_gemini(prompt, key):
    """Model yoğunsa ya da yanıt vermezse beklemeden sıradaki modeli dener. (yanıt, model) döndürür."""
    models = model_list()
    last_error = None
    for position, model in enumerate(models):
        try:
            return call_gemini(prompt, key, model), model
        except GrammarError as exc:
            last_error = exc
            # Yoğun ya da yanıt vermeyen modelden sıradakine geç. Yedek model adı artık yoksa da
            # sessizce geç; asıl modelde 404 ise kullanıcı bilsin.
            if exc.code in ("overloaded", "timeout") or (exc.code == "bad_model" and position > 0):
                continue
            raise
    raise last_error


def response_text(data):
    """Yanıttaki metni çıkarır. Engellenmiş ya da boş yanıtta GrammarError."""
    candidates = data.get("candidates") or []
    if not candidates:
        reason = (data.get("promptFeedback") or {}).get("blockReason", "")
        raise GrammarError(f"Gemini bu transkript için yanıt üretmedi{f' ({reason})' if reason else ''}.", 502, "blocked")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        reason = candidates[0].get("finishReason", "")
        raise GrammarError(f"Gemini boş yanıt döndürdü{f' ({reason})' if reason else ''}.", 502, "empty")
    return text


# ===== Yanıtı doğrulama =====

def as_text(value, limit):
    return str(value).strip()[:limit] if isinstance(value, (str, int, float)) else ""


def clean_topics(raw, lines):
    """Modelin yanıtına güvenmeden alan alan doğrular; satır numarası tutmayan örnekleri atar."""
    if isinstance(raw, dict):
        raw = raw.get("topics")
    if not isinstance(raw, list):
        return []
    topics = []
    for item in raw[:10]:
        if not isinstance(item, dict):
            continue
        title = as_text(item.get("title"), 80)
        explanation = as_text(item.get("explanation"), 600)
        if not title or not explanation:
            continue
        examples = []
        for example in (item.get("examples") or [])[:5]:
            if not isinstance(example, dict):
                continue
            try:
                index = int(example.get("line")) - 1  # modele 1'den başlayan numara verildi
            except (TypeError, ValueError):
                continue
            if not 0 <= index < len(lines):
                continue
            phrase = as_text(example.get("phrase"), 160)
            # İfade o satırda geçmiyorsa vurgulanamaz; yine de cümle örnek olarak gösterilir
            if phrase.lower() not in lines[index]["text"].lower():
                phrase = ""
            examples.append({"line": index, "phrase": phrase, "note": as_text(example.get("note"), 240)})
        if not examples:
            continue
        level = as_text(item.get("level"), 2).upper()
        topics.append({
            "title": title,
            "titleTr": as_text(item.get("titleTr"), 80),
            "level": level if level in LEVELS else "",
            "pattern": as_text(item.get("pattern"), 120),
            "explanation": explanation,
            "tip": as_text(item.get("tip"), 300),
            "examples": examples,
        })
    return topics


# ===== Dışarıya açılan fonksiyon =====

def analyze_grammar(video_id, lines):
    """Videonun gramer konuları. Önbellekte varsa oradan; yoksa Gemini'ye sorar. Hata: GrammarError."""
    if video_id in grammar_cache:
        return grammar_cache[video_id]
    key = load_key()
    if not key:
        raise GrammarError(
            "Gemini anahtarı tanımlı değil. Proje klasöründe gemini_key.txt adında bir dosya oluştur, "
            "anahtarını ilk satırına yapıştır ve bu düğmeye yeniden bas.", 503, "no_key")
    response, model = ask_gemini(build_prompt(lines), key)
    text = response_text(response)
    try:
        raw = json.loads(text)
    except ValueError:
        raise GrammarError("Gemini'nin yanıtı okunamadı (JSON değil). Yeniden dene.", 502, "bad_json")
    topics = clean_topics(raw, lines)
    if not topics:
        raise GrammarError("Gemini bu videoda kullanılabilir bir gramer konusu döndürmedi. Yeniden dene.", 502, "no_topics")
    data = {"model": model, "topics": topics, "truncated": len(lines) > MAX_LINES}
    with cache_lock:
        grammar_cache[video_id] = data
        save_cache()
    return data
