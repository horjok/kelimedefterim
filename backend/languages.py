"""
Öğrenilen diller: uygulamanın hangi dili çalıştırdığına dair bütün dil bilgisi buradan okunur.

Her istek bir dil taşır (?lang=en). Dil verilmezse İngilizce varsayılır, böylece eski bağlantılar ve
önbellekler olduğu gibi çalışır. Yeni bir dil eklemek için:
  1. Aşağıdaki LANGUAGES sözlüğüne kaydını ekle (web/js/lang.js içindeki LANG_INFO ile aynı kod).
  2. O dile özgü parçaları (transkript, telaffuz, kelime çözümleme, istemler, müfredat) yaz.
     "features" listesi arayüzün hangi bölümleri göstereceğini söyler.

Önbellek adları: İngilizce eski adlarını korur ("translations.json"); diğer diller kendi klasörüne yazar
("es/translations.json"). Bkz. storage_name().
"""

DEFAULT = "en"

LANGUAGES = {
    "en": {
        "name": "İngilizce",                     # arayüzde görünen ad (Türkçe)
        "native": "English",
        "transcript": ["en", "en-US", "en-GB", "en-CA", "en-AU"],  # YouTube altyazı dilleri, tercih sırasıyla
        "tts": "en-US",                          # tarayıcının sesli okuma dili
        "translate": "en",                       # Google çevirisinde kaynak dil
        "features": ["ipa", "phrasal", "ielts", "grammar", "wordbank", "topics", "tenses"],
    },
    # İspanyolca (20 Kasım 2026, adım 2: çekirdek). Telaffuz İspanya aksanı (θ, ʝ), dil paketi backend/spanish.py.
    # Adım 3 (20 Kasım 2026): gramer müfredatı (web/data/gramer-es.json), video gramer modu ve Pekiştir (A1–C2).
    # Konulu kelime listeleri web/data/kelime-konulari-es.json; IELTS yalnızca İngilizcede.
    "es": {
        "name": "İspanyolca",
        "native": "Español",
        "transcript": ["es", "es-ES", "es-419", "es-MX", "es-US"],
        "tts": "es-ES",
        "translate": "es",
        "features": ["ipa", "grammar", "wordbank", "topics"],
    },
    # Almanca (21 Kasım 2026): İspanyolcayla aynı yol. Telaffuz Hochdeutsch (kural tabanlı, backend/german.py),
    # isimler büyük harfle; Pekiştir ve eş anlamlılarda artikel (der/die/das) Gemini denetiminden gelir.
    "de": {
        "name": "Almanca",
        "native": "Deutsch",
        "transcript": ["de", "de-DE", "de-AT", "de-CH"],
        "tts": "de-DE",
        "translate": "de",
        "features": ["ipa", "grammar", "wordbank", "topics"],
    },
}


def resolve(code):
    """Geçerli dil kodunu döndürür; boşsa varsayılanı, bilinmiyorsa None."""
    code = (code or "").strip().lower() or DEFAULT
    return code if code in LANGUAGES else None


def info(code):
    return LANGUAGES[code]


def storage_name(code, name):
    """Önbellek adını dile göre ayırır: İngilizce eski adları korur, diğer diller kendi klasörüne yazar."""
    return name if code == DEFAULT else f"{code}/{name}"


def public_list():
    return [{"code": code, "name": data["name"], "native": data["native"], "tts": data["tts"],
             "features": data["features"]} for code, data in LANGUAGES.items()]
