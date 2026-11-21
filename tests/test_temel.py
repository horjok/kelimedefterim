"""Temel uçlar: dil listesi, statik dosyalar, dil seçimi, bölüm kapıları, giriş şifresi."""

from tests.support import ApiTest, app_module  # support her zaman önce (ortamı hazırlar)

import unittest


class LanguageTests(ApiTest):
    def test_dil_listesi(self):
        data = self.get("/api/languages")
        self.assertEqual(data["default"], "en")
        codes = {item["code"]: item for item in data["languages"]}
        self.assertEqual(set(codes), {"en", "es", "de"})
        self.assertEqual(codes["de"]["tts"], "de-DE")
        self.assertNotIn("ielts", codes["de"]["features"])
        self.assertIn("phrasal", codes["en"]["features"])

    def test_bilinmeyen_dil_400(self):
        data = self.get("/api/syllables", 400, word="haus", lang="xx")
        self.assertIn("desteklenmiyor", data["error"])

    def test_dil_verilmezse_ingilizce(self):
        self.assertEqual(self.get("/api/syllables", word="water")["word"], "water")

    def test_bolum_kapilari(self):
        # IELTS yalnızca İngilizcede; gramer ve Pekiştir üç dilde
        for lang in ("es", "de"):
            data = self.post("/api/ielts/speaking", {}, 404, lang=lang)
            self.assertEqual(data["code"], "no_feature")
        self.assertEqual(self.get("/api/wordbank/sources", lang="de"), {"name": "", "levels": {}})
        self.post("/api/wordbank", {"level": "PV"}, 400, lang="de")  # phrasal verb yalnızca İngilizcede


class StaticTests(ApiTest):
    def test_sayfalar_ve_veri_dosyalari(self):
        for path in ("/", "/video.html", "/js/lang.js", "/css/style.css", "/data/gramer-de.json", "/data/kelime-konulari-de.json"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            response.close()

    def test_mufredat_sayilari(self):
        counts = {}
        for name in ("gramer", "gramer-es", "gramer-de"):
            data = self.static_json(f"/data/{name}.json")
            counts[name] = sum(len(category["topics"]) for category in data["categories"])
        self.assertEqual(counts, {"gramer": 121, "gramer-es": 70, "gramer-de": 72})
        topics = self.static_json("/data/kelime-konulari-de.json")["topics"]
        self.assertEqual(len(topics), 31)
        words = [word for topic in topics for level in ("B1", "B2", "C1") for word in topic["words"][level]]
        self.assertEqual(len(words), 1302)
        self.assertEqual(len(set(words)), 1302)

    def test_gizli_dosyalar_sunulmaz(self):
        for path in ("/server.py", "/backend/app.py", "/gemini_key.txt", "/../requirements.txt", "/.env.local"):
            self.assertEqual(self.client.get(path).status_code, 404, path)


class PasswordTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.saved = (app_module.APP_PASSWORD, app_module.ON_VERCEL, app_module.APP_PUBLIC)

    def tearDown(self):
        app_module.APP_PASSWORD, app_module.ON_VERCEL, app_module.APP_PUBLIC = self.saved
        super().tearDown()

    def test_sifre_istenir(self):
        app_module.APP_PASSWORD = "gizli-test"
        self.assertEqual(self.client.get("/api/languages").status_code, 401)
        wrong = self.client.get("/api/languages", auth=("x", "yanlis"))
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(self.client.get("/api/languages", auth=("kim", "gizli-test")).status_code, 200)

    def test_vercelde_sifresiz_acilmaz(self):
        app_module.APP_PASSWORD, app_module.ON_VERCEL, app_module.APP_PUBLIC = "", True, False
        self.assertEqual(self.client.get("/").status_code, 503)
        app_module.APP_PUBLIC = True
        self.assertEqual(self.client.get("/api/languages").status_code, 200)


if __name__ == "__main__":
    unittest.main()
