"""Zaman çizgisi: cümle dönüştürücü (POST /api/tenses). Kurallar (backend/tenses.py) ve Gemini yolu;
zaman çizgisi içeriği (web/data/zamanlar.json) biçim denetimi."""

from tests.support import NET, ApiTest

import unittest

from backend import tenses


def row(result, key, polarity="pos"):
    return next(r for r in result["rows"] if r["key"] == key)[polarity]["text"]


class RuleTests(unittest.TestCase):
    def test_on_iki_zaman_ve_zarf(self):
        result = tenses.convert("She drinks coffee every morning.")
        self.assertTrue(result["supported"])
        self.assertEqual(result["detected"], "present-simple")
        self.assertEqual([r["key"] for r in result["rows"]], tenses.TENSES)
        self.assertEqual(row(result, "present-perfect-continuous"), "She has been drinking coffee every morning.")
        self.assertEqual(row(result, "past-simple", "neg"), "She did not drink coffee every morning.")
        self.assertEqual(row(result, "future-perfect", "q"), "Will she have drunk coffee every morning?")

    def test_soru_biciminde_ozne_kucuk_harf(self):
        result = tenses.convert("The dog barks.")
        self.assertEqual(row(result, "present-simple", "q"), "Does the dog bark?")
        self.assertEqual(row(tenses.convert("Children love sweets."), "past-simple", "q"), "Did children love sweets?")
        self.assertEqual(row(tenses.convert("Mark plays the guitar."), "present-perfect", "q"), "Has Mark played the guitar?")
        self.assertEqual(row(tenses.convert("I usually walk to school."), "present-simple", "q"), "Do I usually walk to school?")

    def test_kisaltmalar_ve_duzensiz_fiiller(self):
        result = tenses.convert("I've finished my homework.")
        self.assertEqual(result["detected"], "present-perfect")
        self.assertEqual(row(result, "past-simple"), "I finished my homework.")
        result = tenses.convert("They were swimming.")
        self.assertEqual(result["detected"], "past-continuous")
        self.assertEqual(row(result, "present-perfect"), "They have swum.")
        self.assertEqual(row(result, "present-continuous"), "They are swimming.")
        self.assertEqual(row(tenses.convert("He stopped the car."), "present-continuous"), "He is stopping the car.")
        self.assertEqual(tenses.convert("She's working now.")["detected"], "present-continuous")
        self.assertEqual(row(tenses.convert("She's always happy."), "present-perfect"), "She has always been happy.")

    def test_olumsuz_ve_durum_fiili(self):
        result = tenses.convert("He doesn't like tea.")
        self.assertTrue(result["negative"])
        self.assertEqual(row(result, "present-simple"), "He likes tea.")
        continuous = next(r for r in result["rows"] if r["key"] == "present-continuous")
        self.assertFalse(continuous["natural"])
        self.assertIn("durum fiili", continuous["note"])
        self.assertEqual(row(tenses.convert("She never eats meat."), "present-simple", "neg"), "She does not ever eat meat.")

    def test_zaman_zarfi_uymayan_zamandan_cikar(self):
        result = tenses.convert("Yesterday I went home.")
        self.assertEqual(row(result, "past-simple"), "Yesterday I went home.")
        self.assertEqual(row(result, "past-simple", "q"), "Did I go home yesterday?")
        future = next(r for r in result["rows"] if r["key"] == "future-simple")
        self.assertEqual(future["pos"]["text"], "I will go home.")
        self.assertIn("çıkarıldı", future["note"])
        self.assertEqual(row(tenses.convert("We have lived here since 2010."), "present-simple"), "We live here.")

    def test_parcalar_rol_tasir(self):
        parts = next(r for r in tenses.convert("She works.")["rows"] if r["key"] == "present-perfect-continuous")["pos"]["parts"]
        self.assertEqual([(p["t"], p["r"]) for p in parts],
                         [("She", ""), ("has", "aux"), ("been", "aux"), ("work", "verb"), ("ing", "suf"), (".", "p")])
        gone = next(r for r in tenses.convert("She goes.")["rows"] if r["key"] == "present-perfect")["pos"]["parts"]
        self.assertIn({"t": "gone", "r": "irr"}, gone)

    def test_desteklenmeyenler(self):
        for sentence in ("Can you help me?", "The house was built in 1990.", "I think that she left.",
                         "I went home and slept.", "I am going to call him.", "She can swim.",
                         "There is a cat.", "She has been to Paris.", "I'd gone home.", "It rained. We stayed in.", ""):
            result = tenses.convert(sentence)
            self.assertFalse(result["supported"], sentence)
            self.assertTrue(result["reason"], sentence)


class ContentTests(unittest.TestCase):
    """web/data/zamanlar.json: 12 zaman, her biri en az 8 soru; cevaplar seçeneklerde; bağlantılar geçerli."""

    @classmethod
    def setUpClass(cls):
        import json
        from backend.config import WEB_DIR
        cls.data = json.loads((WEB_DIR / "data" / "zamanlar.json").read_text(encoding="utf-8"))
        cls.grammar = json.loads((WEB_DIR / "data" / "gramer.json").read_text(encoding="utf-8"))

    def test_zamanlar_ve_baglantilar(self):
        keys = [tense["key"] for tense in self.data["tenses"]]
        self.assertEqual(sorted(keys), sorted(tenses.TENSES))
        topics = {topic["key"] for category in self.grammar["categories"] for topic in category["topics"]}
        for tense in self.data["tenses"]:
            self.assertIn(tense["topic"], topics, tense["key"])
            self.assertEqual(set(tense["pattern"]), {"pos", "neg", "q"})
            self.assertGreaterEqual(len(tense["uses"]), 2)
        for pair in self.data["pairs"]:
            self.assertIn(pair["a"], keys)
            self.assertIn(pair["b"], keys)
            self.assertTrue(pair["ask"] and pair["tip"])
        paired = {pair[side] for pair in self.data["pairs"] for side in ("a", "b")}
        self.assertEqual(paired, set(keys))                    # her zamanın bir karşılaştırma eşi var

    def test_sorular(self):
        ids = set()
        count = {key: 0 for key in tenses.TENSES}
        for question in self.data["questions"]:
            self.assertNotIn(question["id"], ids)
            ids.add(question["id"])
            count[question["tense"]] += 1
            self.assertIn(question["type"], ("place", "gap", "meaning", "signal"))
            self.assertTrue(question["why"], question["id"])
            if question["type"] in ("meaning", "signal"):
                self.assertIn(question["answer"], question["options"], question["id"])
            if question["type"] == "signal":
                self.assertEqual(question["answer"], question["tense"])
                self.assertTrue(all(option in tenses.TENSES for option in question["options"]))
            if question["type"] == "gap":
                self.assertIn("___", question["text"])
                self.assertTrue(question["answer"])
            if question["type"] in ("place", "signal"):
                self.assertIn("**", question["text"])           # sorulan fiil öbeği işaretli
        self.assertTrue(all(n >= 8 for n in count.values()), count)


class ApiTests(ApiTest):
    def test_kural_yolu(self):
        data = self.post("/api/tenses", {"sentence": "The children play football."})
        self.assertEqual(data["source"], "rules")
        self.assertEqual(row(data, "present-perfect"), "The children have played football.")
        self.assertEqual(NET.gemini_prompts, [])

    def test_desteklenmeyen_cumle_ve_bos(self):
        data = self.post("/api/tenses", {"sentence": "I think that she left."})
        self.assertFalse(data["supported"])
        self.post("/api/tenses", {"sentence": "  "}, 400)

    def test_gemini_yolu_onbellekli(self):
        data = self.post("/api/tenses", {"sentence": "I would have called you.", "ai": True})
        self.assertEqual(data["source"], "gemini")
        self.assertEqual(len(data["rows"]), 12)
        self.assertEqual(data["rows"][0]["tr"], "Türkçesi 0")
        self.assertFalse(data["rows"][1]["natural"])
        self.assertIn("all twelve tenses", NET.gemini_prompts[0][1])
        self.assertIn("i would have called you.", self.cached("tenses.json"))
        self.post("/api/tenses", {"sentence": "I  would have called you.", "ai": True})
        self.assertEqual(len(NET.gemini_prompts), 1)          # aynı cümle önbellekten

    def test_gemini_eksik_ve_bozuk_yanit(self):
        self.assertEqual(self.post("/api/tenses", {"sentence": "EKSIK cümle olsun.", "ai": True}, 502)["code"], "bad_json")
        NET.gemini_mode = "bad_json"
        self.assertEqual(self.post("/api/tenses", {"sentence": "Bozuk yanıt olsun.", "ai": True}, 502)["code"], "bad_json")
        cache = self.cached("tenses.json") or {}
        self.assertNotIn("eksik cümle olsun.", cache)
        self.assertNotIn("bozuk yanıt olsun.", cache)

    def test_diger_dillerde_kapali(self):
        self.assertEqual(self.post("/api/tenses", {"sentence": "Ella come pan."}, 404, lang="es")["code"], "no_feature")


if __name__ == "__main__":
    unittest.main()
