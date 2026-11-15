"""
Gemini API ortak katmanı: anahtar, istek, yedek model, yanıtı JSON olarak okuma.
grammar.py (gramer konuları) ve ielts.py (IELTS alıştırmaları) bunu kullanır.

- Anahtar: GEMINI_API_KEY ortam değişkeni ya da proje kökündeki gemini_key.txt dosyasının ilk satırı.
  (.txt dosyaları sunucudan dışarı açılmaz; anahtarı koda ya da not defterine yazma.)
- Model: GEMINI_MODEL ortam değişkeni, yoksa "gemini-flash-lite-latest" (Google'ın en yeni hızlı Flash-Lite modeline
  işaret eden takma ad). Model yoğunsa (503) ya da yanıt vermezse beklemeden FALLBACK_MODELS listesindeki
  sıradaki model denenir.
"""

import json
import os
import time
import urllib.error
import urllib.request

from .config import KEY_FILE

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Hız için asıl model Flash-Lite: 15 Kasım 2026 ölçümünde ~5 sn, kalite aynı.
# Büyük Flash modeli (gemini-flash-latest) o gün sürekli 503/zaman aşımı veriyordu; artık son yedek.
DEFAULT_MODEL = "gemini-flash-lite-latest"
# Asıl model yoğunsa (503) ya da yanıt vermezse sırayla bunlar denenir. Google model adlarını sık değiştirir:
# biri kalkarsa (404) atlanır, GEMINI_FALLBACK_MODELS ortam değişkeniyle (virgüllü) değiştirilebilir.
FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest"]
REQUEST_TIMEOUT = 30  # bir modelin yanıtı için en çok beklenen saniye
RETRY_WAIT = 2        # bütün hızlı modeller yoğunsa asıl modeli yeniden denemeden önce beklenen saniye


class GeminiError(Exception):
    """Kullanıcıya gösterilecek Türkçe mesaj + HTTP kodu + kısa hata türü."""

    def __init__(self, message, status, code):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


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


def call_gemini(prompt, key, model, temperature=0.2, system=""):
    """system: modelin rolünü belirleyen sistem talimatı (persona); boşsa gönderilmez."""
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": temperature},
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    body = json.dumps(payload).encode("utf-8")
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
            raise GeminiError("Gemini anahtarı geçersiz ya da yetkisiz. gemini_key.txt dosyasındaki anahtarı kontrol et.", 502, "bad_key")
        if exc.code == 404:
            raise GeminiError(f"Gemini modeli bulunamadı: {model}. GEMINI_MODEL değerini kontrol et.", 502, "bad_model")
        if exc.code == 429:
            raise GeminiError("Gemini kotası doldu ya da çok sık istek geldi. Biraz sonra yeniden dene.", 503, "quota")
        if exc.code in (500, 503):
            raise GeminiError("Gemini şu an çok yoğun, yanıt veremedi. Bir iki dakika sonra yeniden dene.", 503, "overloaded")
        raise GeminiError(f"Gemini hata verdi (kod {exc.code}). {detail[:200]}".strip(), 502, "api_error")
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(exc, TimeoutError) or isinstance(reason, TimeoutError) or "timed out" in str(reason):
            raise GeminiError("Gemini zamanında yanıt vermedi. Bir iki dakika sonra yeniden dene.", 503, "timeout")
        raise GeminiError(f"Gemini'ye ulaşılamadı ({exc.__class__.__name__}).", 502, "network")


def model_list():
    """Denenecek modeller: önce asıl model, sonra yedekler (tekrarsız)."""
    main = os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    extra = os.environ.get("GEMINI_FALLBACK_MODELS", "")
    fallbacks = [name.strip() for name in extra.split(",") if name.strip()] if extra.strip() else FALLBACK_MODELS
    return list(dict.fromkeys([main, *fallbacks]))


def ask_gemini(prompt, key, temperature=0.2, system=""):
    """Model yoğunsa ya da yanıt vermezse sıradaki modeli dener. (yanıt, model) döndürür.
    Sıra: asıl model, ilk yedek, kısa bir aradan sonra asıl model bir kez daha, en son kalan (yavaş) yedekler.
    Hızlı modeller çoğu zaman birkaç saniye içinde yeniden yanıt verir; yavaş modelde 30 sn beklemeden önce denenir."""
    models = model_list()
    order = [(model, 0) for model in models[:2]] + [(models[0], RETRY_WAIT)] + [(model, 0) for model in models[2:]]
    last_error = None
    for position, (model, wait) in enumerate(order):
        if wait:
            time.sleep(wait)
        try:
            return call_gemini(prompt, key, model, temperature, system), model
        except GeminiError as exc:
            last_error = exc
            # Yoğun ya da yanıt vermeyen modelden sıradakine geç. Yedek model adı artık yoksa da
            # sessizce geç; asıl modelde 404 ise kullanıcı bilsin.
            if exc.code in ("overloaded", "timeout") or (exc.code == "bad_model" and position > 0):
                continue
            raise
    raise last_error


def response_text(data):
    """Yanıttaki metni çıkarır. Engellenmiş ya da boş yanıtta GeminiError."""
    candidates = data.get("candidates") or []
    if not candidates:
        reason = (data.get("promptFeedback") or {}).get("blockReason", "")
        raise GeminiError(f"Gemini yanıt üretmedi{f' ({reason})' if reason else ''}.", 502, "blocked")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        reason = candidates[0].get("finishReason", "")
        raise GeminiError(f"Gemini boş yanıt döndürdü{f' ({reason})' if reason else ''}.", 502, "empty")
    return text


NO_KEY_MESSAGE = (
    "Gemini anahtarı tanımlı değil. Proje klasöründe gemini_key.txt adında bir dosya oluştur, "
    "anahtarını ilk satırına yapıştır ve bu düğmeye yeniden bas."
)


def generate_json(prompt, temperature=0.2, system=""):
    """İstemi (ve varsa sistem talimatını) gönderir, yanıtı JSON olarak okur. (veri, model) döndürür. Hata: GeminiError."""
    key = load_key()
    if not key:
        raise GeminiError(NO_KEY_MESSAGE, 503, "no_key")
    response, model = ask_gemini(prompt, key, temperature, system)
    text = response_text(response)
    try:
        return json.loads(text), model
    except ValueError:
        raise GeminiError("Gemini'nin yanıtı okunamadı (JSON değil). Yeniden dene.", 502, "bad_json")


def as_text(value, limit):
    """Modelden gelen alanı güvenli metne çevirir (metin/sayı değilse boş)."""
    return str(value).strip()[:limit] if isinstance(value, (str, int, float)) else ""
