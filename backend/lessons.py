"""
Gramer bölümü (genel İngilizce): müfredattaki her konu için ayrıntılı Türkçe anlatım ve alıştırma.

- Müfredat web/data/gramer.json dosyasındadır (tek kaynak: sayfa da aynı dosyayı okur). Her konu:
  {key, en, tr, level (A1-C1), pattern, use, example, subtopics}. subtopics: konunun içinde işlenecek alt başlıklar.
  Konu kapsamı Grammar in Use serisinin üç seviyesindeki konularla karşılaştırılarak belirlendi; kitaplardan
  metin, örnek ya da alıştırma alınmadı (telif). Anlatımlar özgündür.
- get_lesson(key)  → konunun ayrıntılı anlatımı. Gemini (İngilizce öğretmeni personası) bir kez üretir,
  cache/lessons/<key>.json içinde saklanır; sonraki açılışlar anında gelir.
- make_quiz(key)   → konunun seviyesinde 8 soruluk alıştırma (her seferinde yeni).
Modelin yanıtı alan alan doğrulanır. İçerik yapay zekâ üretimidir, hata içerebilir.

Diller (20 Kasım 2026): her dilin kendi müfredat dosyası var (CURRICULUM_FILES; İspanyolca web/data/gramer-es.json,
konu adı "en" yerine "name" alanında), kendi öğretmen personası ve istemleri (PERSONAS, LESSON_PROMPTS, QUIZ_PROMPTS).
İngilizce istemler değişmedi. Anlatımlar dile göre ayrı saklanır (es/lessons/<konu>.json).
"""

import hashlib
import json
import re
import time

from . import languages, storage
from .config import WEB_DIR
from .gemini import GeminiError, as_text, generate_json
from .ielts import BLANK, MIN_QUESTIONS, clean_question, norm

CURRICULUM_FILE = WEB_DIR / "data" / "gramer.json"
CURRICULUM_FILES = {"en": CURRICULUM_FILE, "es": WEB_DIR / "data" / "gramer-es.json"}
TOPIC_KEY = re.compile(r"^[a-z][a-z0-9-]{1,40}$")
MAX_USES = 12  # alt başlığı çok olan konularda her alt başlığa en az bir kural düşsün

TEACHER_PERSONA = """You are an experienced English teacher who teaches grammar to Turkish-speaking learners.

How you teach:
- You explain in clear, natural Turkish, the learner's first language, and address the learner as "sen".
- You start from meaning and use (when and why a structure is used), then show the form.
- Every rule comes with a short, natural English example sentence and its Turkish translation.
- You compare English with Turkish where it helps, and you know where Turkish speakers go wrong
  (articles, prepositions, tense choice, word order, subject-verb agreement, literal translation).
- You pitch vocabulary and sentence length to the learner's CEFR level.
- You are accurate: you do not invent rules, and you mention the important exceptions.
- You reply with a single JSON object in exactly the requested shape and nothing else."""

SPANISH_PERSONA = """You are an experienced Spanish teacher who teaches grammar to Turkish-speaking learners.
You teach the Spanish of Spain (castellano peninsular): conjugations include vosotros, and you mention
Latin American usage (ustedes for vosotros, preterite instead of the perfect) only where it matters.

How you teach:
- You explain in clear, natural Turkish, the learner's first language, and address the learner as "sen".
- You start from meaning and use (when and why a structure is used), then show the form.
- Every rule comes with a short, natural Spanish example sentence and its Turkish translation.
- You compare Spanish with Turkish where it helps, and you know where Turkish speakers go wrong
  (grammatical gender and agreement, articles, ser and estar, por and para, preterite and imperfect,
  the subjunctive, object pronouns and their position, reflexive verbs, prepositions, literal translation).
- You write Spanish with correct accents (á, é, í, ó, ú, ü, ñ) and inverted marks (¿ ¡).
- You pitch vocabulary and sentence length to the learner's CEFR level.
- You are accurate: you do not invent rules, and you mention the important exceptions.
- You reply with a single JSON object in exactly the requested shape and nothing else."""

PERSONAS = {"en": TEACHER_PERSONA, "es": SPANISH_PERSONA}

LEVEL_NOTES = {
    "A1": "A1 beginner: very short sentences, the most common everyday words only.",
    "A2": "A2 elementary: short everyday sentences, common vocabulary.",
    "B1": "B1 intermediate: everyday and general-interest sentences of normal length.",
    "B2": "B2 upper-intermediate: longer sentences, wider vocabulary, some formal examples.",
    "C1": "C1 advanced: complex, formal and idiomatic sentences.",
}


# ===== Müfredat =====

def load_topics(lang="en"):
    """Müfredatı her seferinde dosyadan okur (dosya küçük; düzenleyince sunucuyu yeniden başlatmak gerekmez)."""
    path = CURRICULUM_FILES.get(lang)
    if path is None:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    topics = {}
    for category in data.get("categories", []):
        for topic in category.get("topics", []):
            if TOPIC_KEY.match(str(topic.get("key", ""))):
                topics[topic["key"]] = topic
    return topics


def topic_name(topic):
    """Konunun öğrenilen dildeki adı: İngilizce müfredatta "en", diğerlerinde "name"."""
    return topic.get("en") or topic.get("name", "")


def topic_hash(topic):
    """Konunun tanımı değişince (ad, kalıp, alt başlıklar) saklanan anlatım eskir; bunu anlamak için kısa özet."""
    text = "|".join([topic_name(topic), topic.get("pattern", ""), *topic.get("subtopics", [])])
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def subtopic_note(topic):
    """İstemlere eklenen alt başlık listesi (yoksa boş)."""
    subs = [str(text) for text in topic.get("subtopics", []) if str(text).strip()]
    if not subs:
        return ""
    return "Sub-points this topic must cover (given in Turkish; cover every one of them):\n" + "\n".join(f"- {text}" for text in subs)


def find_topic(key, lang="en"):
    topic = load_topics(lang).get(key) if TOPIC_KEY.match(key or "") else None
    if topic is None:
        raise GeminiError("Bilinmeyen gramer konusu.", 404, "bad_request")
    return topic


# ===== Konu anlatımı =====

LESSON_PROMPT = """Write a complete grammar lesson for your learner.
Grammar point: {en}
Learner level: {level_note}
Core pattern (already shown to the learner): {pattern}
{subtopics}

Return ONLY a JSON object with this exact shape:
{{"intro": "2-4 sentences in Turkish: what this structure means and when it is used",
  "forms": [{{"name": "Olumlu", "pattern": "özne + ...", "example": "English sentence", "tr": "Turkish translation"}}],
  "uses": [{{"sub": "the sub-point this belongs to, copied exactly from the list above (empty string if no list)", "rule": "one use or rule, in Turkish", "example": "English sentence", "tr": "Turkish translation"}}],
  "signals": ["typical time expressions or key words used with this structure"],
  "mistakes": [{{"wrong": "a typical wrong sentence", "right": "the corrected sentence", "why": "short reason in Turkish"}}],
  "compare": "in Turkish: how this differs from the structure learners most often confuse it with (empty string if none)",
  "tip": "one memorable tip in Turkish"}}

Rules:
- "forms": the forms a learner needs for this point. For tenses and verb structures give Olumlu, Olumsuz and Soru
  (add short answers or contractions inside the pattern if useful). For other topics give the main patterns (2 to 5).
- "uses": 3 to 6 separate uses or rules, each with its own example. Cover the important exceptions.
  If a list of sub-points is given, write at least one use for EVERY sub-point (up to 12 uses in total),
  in the order of the list, and put the sub-point text in "sub".
- "signals": 0 to 8 items; leave the list empty if the topic has no typical signal words.
- "mistakes": exactly 3 mistakes that Turkish speakers really make with this structure.
- All explanations are in Turkish; all examples are natural English at the learner's level with a Turkish translation."""

# İspanyolca: aynı biçim, dil adı değişir; fiil çekimleri için ek kural
LESSON_PROMPT_ES = LESSON_PROMPT.replace("English", "Spanish") + """
- For verb tenses and moods, the "pattern" of each form shows the endings for all six persons
  (yo / tú / él, ella, usted / nosotros / vosotros / ellos, ustedes), using regular -ar, -er and -ir verbs;
  mention the most important irregular verbs in "uses".
- Keep gender and number agreement correct in every example; write all accents and ¿ ¡ marks."""

LESSON_PROMPTS = {"en": LESSON_PROMPT, "es": LESSON_PROMPT_ES}


def clean_lesson(raw):
    """Modelin yanıtını alan alan doğrular; kullanılamazsa None."""
    if not isinstance(raw, dict):
        return None
    intro = as_text(raw.get("intro"), 900)
    forms = []
    for item in (raw.get("forms") or [])[:8]:
        if isinstance(item, dict) and as_text(item.get("pattern"), 200) and as_text(item.get("example"), 240):
            forms.append({"name": as_text(item.get("name"), 40), "pattern": as_text(item.get("pattern"), 200),
                          "example": as_text(item.get("example"), 240), "tr": as_text(item.get("tr"), 240)})
    uses = []
    for item in (raw.get("uses") or [])[:MAX_USES]:
        if isinstance(item, dict) and as_text(item.get("rule"), 400) and as_text(item.get("example"), 240):
            uses.append({"sub": as_text(item.get("sub"), 120), "rule": as_text(item.get("rule"), 400),
                         "example": as_text(item.get("example"), 240), "tr": as_text(item.get("tr"), 240)})
    mistakes = []
    for item in (raw.get("mistakes") or [])[:5]:
        if not isinstance(item, dict):
            continue
        wrong, right = as_text(item.get("wrong"), 240), as_text(item.get("right"), 240)
        if wrong and right and norm(wrong) != norm(right):
            mistakes.append({"wrong": wrong, "right": right, "why": as_text(item.get("why"), 300)})
    if not intro or len(uses) < 2:
        return None
    return {
        "intro": intro, "forms": forms, "uses": uses, "mistakes": mistakes,
        "signals": [as_text(text, 40) for text in (raw.get("signals") or []) if as_text(text, 40)][:10],
        "compare": as_text(raw.get("compare"), 700), "tip": as_text(raw.get("tip"), 400),
    }


def get_lesson(key, fresh=False, lang="en"):
    """Konunun ayrıntılı anlatımı. Diskte varsa oradan; yoksa (ya da fresh ise) Gemini'ye yazdırır."""
    topic = find_topic(key, lang)
    name = languages.storage_name(lang, f"lessons/{key}.json")
    signature = topic_hash(topic)
    if not fresh:
        saved = storage.read(name)
        if isinstance(saved, dict) and saved.get("topicHash") == signature:  # müfredat değiştiyse eski anlatım kullanılmaz
            return saved
    raw, model = generate_json(LESSON_PROMPTS[lang].format(
        en=topic_name(topic), pattern=topic.get("pattern", ""), level_note=LEVEL_NOTES.get(topic.get("level"), LEVEL_NOTES["B1"]),
        subtopics=subtopic_note(topic),
    ), temperature=0.3, system=PERSONAS[lang])
    lesson = clean_lesson(raw)
    if lesson is None:
        raise GeminiError("Gemini bu konu için kullanılabilir bir anlatım döndürmedi. Yeniden dene.", 502, "no_content")
    data = {"key": key, "model": model, "created": int(time.time()), "topicHash": signature, **lesson}
    storage.write(name, data)
    return data


# ===== Alıştırma =====

QUIZ_PROMPT = """Write an ORIGINAL practice exercise for your learner.
Grammar point: {en}
Learner level: {level_note}
{subtopics}

Return ONLY a JSON object with this exact shape:
{{"questions": [
  {{"type": "choice", "prompt": "a sentence with _____ where the answer goes", "options": ["...", "...", "...", "..."], "answer": "the full text of the correct option", "explanation": "..."}},
  {{"type": "gap", "prompt": "a sentence with _____ and the base word in brackets, e.g. She _____ (go) to school every day.", "answer": "goes", "accept": ["optional other fully correct spellings, e.g. contractions"], "explanation": "..."}}
]}}

Rules:
- Write 8 questions: 5 "choice" with exactly 4 options and 3 "gap". Mix them, easier ones first.
- If a list of sub-points is given, spread the questions across them.
- Every question tests the grammar point above and has exactly one correct option. Wrong options are errors that
  Turkish-speaking learners really make.
- For "gap": the answer is one to four words; give the base word in brackets so only one answer is correct.
  Put any other fully correct form in "accept".
- "explanation" is one or two short sentences in Turkish: the rule, and why the common wrong choice is wrong.
- Each prompt contains _____ exactly once. Sentences are natural English at the learner's level."""

QUIZ_PROMPT_ES = """Write an ORIGINAL practice exercise for your learner.
Grammar point: {en}
Learner level: {level_note}
{subtopics}

Return ONLY a JSON object with this exact shape:
{{"questions": [
  {{"type": "choice", "prompt": "a sentence with _____ where the answer goes", "options": ["...", "...", "...", "..."], "answer": "the full text of the correct option", "explanation": "..."}},
  {{"type": "gap", "prompt": "a sentence with _____ and the base word in brackets, e.g. Mi hermana _____ (vivir) en Sevilla.", "answer": "vive", "accept": ["optional other fully correct forms"], "explanation": "..."}}
]}}

Rules:
- Write 8 questions: 5 "choice" with exactly 4 options and 3 "gap". Mix them, easier ones first.
- If a list of sub-points is given, spread the questions across them.
- Every question tests the grammar point above and has exactly one correct option. Wrong options are errors that
  Turkish-speaking learners really make (wrong gender or agreement, ser/estar, por/para, wrong tense or mood).
- For "gap": the answer is one to four words with correct accents; give the base word (infinitive, or masculine
  singular adjective) in brackets so only one answer is correct. When the answer has no base form (a preposition,
  article, pronoun or conjunction), put the possible choices in brackets instead, e.g. (por / para) or (lo / le).
  Put any other fully correct form in "accept" (for example the -se form of the imperfect subjunctive).
- "explanation" is one or two short sentences in Turkish: the rule, and why the common wrong choice is wrong.
- Each prompt contains _____ exactly once. Sentences are natural Spanish of Spain at the learner's level,
  with all accents and ¿ ¡ marks."""

QUIZ_PROMPTS = {"en": QUIZ_PROMPT, "es": QUIZ_PROMPT_ES}


def make_quiz(key, lang="en"):
    topic = find_topic(key, lang)
    raw, model = generate_json(QUIZ_PROMPTS[lang].format(
        en=topic_name(topic), level_note=LEVEL_NOTES.get(topic.get("level"), LEVEL_NOTES["B1"]), subtopics=subtopic_note(topic),
    ), temperature=0.8, system=PERSONAS[lang])
    items = raw.get("questions") if isinstance(raw, dict) else None
    questions = []
    for item in (items or [])[:12]:
        question = clean_question(item, None)
        if question is None or question["type"] == "tfng":
            continue
        question["prompt"] = re.sub(r"_{3,}", BLANK, question["prompt"])
        questions.append(question)
    if len(questions) < MIN_QUESTIONS:
        raise GeminiError("Gemini yeterli sayıda geçerli soru döndürmedi. Yeniden dene.", 502, "no_content")
    return {"topic": key, "level": topic.get("level", ""), "model": model, "questions": questions}
