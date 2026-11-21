"""Gemini kullanan bölümler uçtan uca: gramer anlatımı ve alıştırması, video gramer modu, eş anlamlılar,
Pekiştir kelime haznesi; Gemini'nin hata durumları (kota, yoğunluk, bozuk yanıt, anahtar yok)."""

import os

from tests.support import NET, ApiTest

import unittest


class LessonTests(ApiTest):
    def test_almanca_anlatim_onbellekli(self):
        data = self.get("/api/lesson", topic="dativ", lang="de")
        self.assertEqual(data["forms"][0]["example"], "Ich helfe dem Mann.")
        self.assertEqual(len(data["mistakes"]), 3)
        self.assertEqual(len(data["uses"]), 2)                    # örneksiz kural doğrulamada atıldı
        model, prompt, system = NET.gemini_prompts[0]
        self.assertEqual(model, "test-model")
        self.assertIn("German", prompt)
        self.assertIn("Nominativ, Akkusativ, Dativ", prompt)      # Almanca istem eki
        self.assertIn("German", system)                           # Almanca öğretmen personası
        self.assertIsNotNone(self.cached("de/lessons/dativ.json"))
        # ikinci açılış önbellekten; fresh=1 yeniden üretir
        self.get("/api/lesson", topic="dativ", lang="de")
        self.assertEqual(len(NET.gemini_prompts), 1)
        self.get("/api/lesson", topic="dativ", lang="de", fresh="1")
        self.assertEqual(len(NET.gemini_prompts), 2)

    def test_konu_dile_gore(self):
        self.assertEqual(self.get("/api/lesson", 404, topic="dativ", lang="es")["code"], "bad_request")
        self.get("/api/lesson", 404, topic="../gizli", lang="de")

    def test_alistirma(self):
        data = self.post("/api/lesson/quiz", {"topic": "akkusativ"}, lang="de")
        self.assertEqual(len(data["questions"]), 8)
        self.assertEqual(sum(1 for q in data["questions"] if q["type"] == "gap"), 3)
        self.assertIn("weil / denn", NET.gemini_prompts[0][1])    # Almanca alıştırma istemi
        # alıştırma saklanmaz: her istek yeniden üretir
        self.post("/api/lesson/quiz", {"topic": "akkusativ"}, lang="de")
        self.assertEqual(len(NET.gemini_prompts), 2)

    def test_ielts_gramer_ingilizcede(self):
        data = self.post("/api/ielts/grammar", {"topic": "tenses", "level": 6})
        self.assertEqual(len(data["questions"]), 8)
        self.post("/api/ielts/grammar", {"topic": "yok"}, 400)


class VideoGrammarTests(ApiTest):
    def test_almanca_video_gramer(self):
        data = self.get("/api/grammar", url="deTestVid01", lang="de")
        topic = data["topics"][0]
        self.assertEqual(topic["title"], "Testkonu")
        # satır numarası tutmayan örnek atılır; 1'den başlayan numara 0'dan başlayana çevrilir
        self.assertEqual([example["line"] for example in topic["examples"]], [0])
        self.assertEqual(topic["examples"][0]["phrase"], "Hallo zusammen,")
        self.assertIn("German grammar teacher", NET.gemini_prompts[0][1])
        self.assertIn("deTestVid01", self.cached("de/grammar.json"))
        self.get("/api/grammar", url="deTestVid01", lang="de")
        self.assertEqual(len(NET.gemini_prompts), 1)              # aynı video için Gemini bir kez


class SynonymTests(ApiTest):
    def test_almanca_artikel_ve_temizlik(self):
        data = self.get("/api/synonyms", word="Tisch", lang="de")
        self.assertEqual(data["word"], "Tisch")
        synonyms = data["senses"][0]["synonyms"]
        # kelimenin kendisi ve büyük-küçük harf farkıyla tekrar eden öğe atılır; artikel korunur
        self.assertEqual([(item["word"], item.get("article")) for item in synonyms], [("Schreibtisch", "der"), ("Pult", "das")])
        self.assertEqual(data["senses"][0]["pos"], "isim")
        self.assertIn('"article"', NET.gemini_prompts[0][2])      # Almanca sistem talimatı artikel ister
        # önbellek anahtarı küçük harf: "tisch" araması Gemini'ye gitmez
        again = self.get("/api/synonyms", word="tisch", lang="de")
        self.assertEqual(len(NET.gemini_prompts), 1)
        self.assertEqual(again["senses"], data["senses"])
        self.assertIn("tisch", self.cached("de/synonyms.json"))

    def test_ispanyolcada_artikel_yok(self):
        data = self.get("/api/synonyms", word="mesa", lang="es")
        self.assertTrue(all("article" not in item for sense in data["senses"] for item in sense["synonyms"]))

    def test_gecersiz_kelime(self):
        self.get("/api/synonyms", 400, word="12 ab", lang="de")
        self.assertEqual(NET.gemini_prompts, [])


class WordBankTests(ApiTest):
    def test_almanca_konulu_hazne_artikelli(self):
        NET.wiktionary = {"Brot": ("de", "Noun")}
        data = self.post("/api/wordbank", {"level": "B1", "count": 6, "exclude": [], "topic": "food"}, lang="de")
        words = data["words"]
        self.assertEqual(len(words), 6)
        for item in words:
            self.assertTrue(item["tr"] and item["ipa"] and item["example"], item)
            self.assertIn(item["word"], item["example"])
            if item["word"][:1].isupper():
                self.assertEqual(item.get("art"), "die", item)    # Gemini denetiminden gelen artikel
            else:
                self.assertNotIn("art", item)
            self.assertNotIn("chk", item)                         # iç alanlar yanıtta yok
        # Almanca fiiller "zu" ile çevrildi; denetim Almanca istemle
        bank = self.cached("de/wordbank/B1.json")
        verbs = [word for word, entry in bank.items() if entry.get("pos") == "fiil"]
        sent = " ".join(text for _url, text in NET.calls("translate.googleapis.com"))
        for verb in verbs:
            self.assertIn(f"zu+{verb}", sent)
        self.assertTrue(any("German vocabulary" in prompt for _model, prompt, _system in NET.gemini_prompts))
        for item in words:
            self.assertTrue(bank[item["word"]].get("chk"), item["word"])  # denetlendi, bir daha sorulmaz

    def test_karisik_seviye_ve_bilinenler(self):
        first = self.post("/api/wordbank", {"level": "A2", "count": 4}, lang="de")["words"]
        known = [item["word"].lower() for item in first]
        second = self.post("/api/wordbank", {"level": "A2", "count": 4, "exclude": known}, lang="de")["words"]
        self.assertFalse({item["word"].lower() for item in second} & set(known))

    def test_gemini_yoksa_kelimeler_yine_gelir(self):
        NET.gemini_mode = "quota"
        words = self.post("/api/wordbank", {"level": "B2", "count": 3, "topic": "travel"}, lang="de")["words"]
        self.assertEqual(len(words), 3)
        self.assertTrue(all("art" not in item for item in words))  # denetim olmadan artikel yok
        bank = self.cached("de/wordbank/B2.json")
        self.assertFalse(any(entry.get("chk") for entry in bank.values()))

    def test_gecersiz_istekler(self):
        self.post("/api/wordbank", {"level": "Z9"}, 400, lang="de")
        self.post("/api/wordbank", {"level": "B1", "topic": "olmayan-konu"}, 400, lang="de")


class GeminiFailureTests(ApiTest):
    def test_kota(self):
        NET.gemini_mode = "quota"
        data = self.get("/api/lesson", 503, topic="genitiv", lang="de")
        self.assertEqual(data["code"], "quota")

    def test_asil_model_yogunsa_yedek(self):
        NET.gemini_mode = "overloaded-main"
        data = self.get("/api/lesson", topic="plural", lang="de")
        self.assertEqual(data["model"], "test-yedek")
        self.assertEqual([model for model, _p, _s in NET.gemini_prompts], ["test-model", "test-yedek"])

    def test_zaman_asimi(self):
        NET.gemini_mode = "timeout"
        self.assertEqual(self.get("/api/lesson", 503, topic="negation", lang="de")["code"], "timeout")

    def test_bozuk_json(self):
        NET.gemini_mode = "bad_json"
        self.assertEqual(self.get("/api/grammar", 502, url="deTestVid02", lang="de")["code"], "bad_json")
        NET.gemini_mode = "ok"
        self.assertTrue(self.get("/api/grammar", url="deTestVid02", lang="de")["topics"])  # hata önbelleğe alınmadı

    def test_anahtar_yok(self):
        saved = os.environ.pop("GEMINI_API_KEY")
        try:
            data = self.get("/api/synonyms", 503, word="Haus", lang="de")
        finally:
            os.environ["GEMINI_API_KEY"] = saved
        self.assertEqual(data["code"], "no_key")
        self.assertEqual(NET.gemini_prompts, [])


if __name__ == "__main__":
    unittest.main()
