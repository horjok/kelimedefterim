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
        "features": ["ipa", "phrasal", "ielts", "grammar", "wordbank"],
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
