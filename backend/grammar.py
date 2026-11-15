"""
Videodaki gramer konularını Gemini API ile çıkarır (istek katmanı: gemini.py).
Sonuçlar cache/grammar.json dosyasında saklanır: aynı video için API ikinci kez çağrılmaz.
"""

import json
import threading

from .config import CACHE_DIR
from .gemini import GeminiError, as_text, generate_json

GrammarError = GeminiError  # eski ad; app.py bu adla yakalar

CACHE_FILE = CACHE_DIR / "grammar.json"
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

MAX_LINES = 160    # çok uzun videolarda yalnızca baştaki bu kadar cümle gönderilir
MAX_CHARS = 14000  # istek metni için üst sınır
cache_lock = threading.Lock()


# ===== Önbellek =====

def load_cache():
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


grammar_cache = load_cache()  # video id -> {"model": ..., "topics": [...]}


def save_cache():
    CACHE_FILE.parent.mkdir(exist_ok=True)
    CACHE_FILE.write_text(json.dumps(grammar_cache, ensure_ascii=False, indent=1), encoding="utf-8")


# ===== İstem =====

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


# ===== Yanıtı doğrulama =====

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
    raw, model = generate_json(build_prompt(lines))
    topics = clean_topics(raw, lines)
    if not topics:
        raise GrammarError("Gemini bu videoda kullanılabilir bir gramer konusu döndürmedi. Yeniden dene.", 502, "no_topics")
    data = {"model": model, "topics": topics, "truncated": len(lines) > MAX_LINES}
    with cache_lock:
        grammar_cache[video_id] = data
        save_cache()
    return data
