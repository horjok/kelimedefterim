"""Video akışı uçtan uca: transkript → kelime listesi → heceleme, kelime arama, cümle çevirisi (en, es, de)."""

from tests.support import NET, YOUTUBE, ApiTest

import unittest


def words_of(vocab):
    """Kelime listesindeki bütün kelimeler: {kelime: kayıt} (seviyeler + Temel)."""
    entries = [entry for level in vocab["levels"].values() for entry in level] + vocab["basic"]
    return {entry["word"]: entry for entry in entries}


class TranscriptTests(ApiTest):
    def test_link_bicimleri(self):
        for url in ("enTestVid01", "https://youtu.be/enTestVid01", "https://www.youtube.com/watch?v=enTestVid01&t=3",
                    "https://www.youtube.com/shorts/enTestVid01"):
            self.assertEqual(self.get("/api/transcript", url=url)["videoId"], "enTestVid01")
        self.get("/api/transcript", 400, url="https://example.com/video")

    def test_transkript_dile_gore_ayri(self):
        data = self.get("/api/transcript", url="deTestVid01", lang="de")
        self.assertEqual(data["language"], "de")
        self.assertEqual(data["title"], "Test videosu deTestVid01")
        self.assertEqual(len(data["lines"]), 6)
        first = data["lines"][1]
        self.assertEqual([word["text"] for word in first["words"]][:3], ["Heute", "sprechen", "wir"])
        ipa = {word["text"]: word["ipa"] for line in data["lines"] for word in line["words"]}
        self.assertEqual(ipa["Straße."], "ˈʃtʁaːsə")
        self.assertEqual(ipa["Wetter"], "ˈvɛtɐ")
        self.assertEqual(ipa["gefahren."], "ɡəˈfaːʁən")     # ge- vurgusuz
        self.assertEqual(ipa["zurück"], "tsuˈʁʏk")
        # YouTube'dan Almanca altyazı istendi; diske dil klasörüne yazıldı, İngilizce klasörüne değil
        self.assertIn(("deTestVid01", ("de", "de-DE", "de-AT", "de-CH")), YOUTUBE.fetched)
        self.assertIsNotNone(self.cached("de/transcripts/deTestVid01.json"))
        self.assertIsNone(self.cached("transcripts/deTestVid01.json"))
        # ikinci istek YouTube'a gitmez
        before = len(YOUTUBE.fetched)
        self.get("/api/transcript", url="deTestVid01", lang="de")
        self.assertEqual(len(YOUTUBE.fetched), before)

    def test_ispanyolca_okunus(self):
        data = self.get("/api/transcript", url="esTestVid01", lang="es")
        ipa = {word["text"]: word["ipa"] for line in data["lines"] for word in line["words"]}
        self.assertEqual(ipa["estación"], "estaˈθjon")

    def test_transkript_hatalari(self):
        self.assertEqual(self.get("/api/transcript", 404, url="noSubsVid01")["error"], "Bu videoda altyazı/transkript kapalı.")
        self.assertIn("engelliyor", self.get("/api/transcript", 503, url="blockedVid1")["error"])


class VocabTests(ApiTest):
    def test_ingilizce_kelimeler_ve_phrasal(self):
        data = self.get("/api/vocab", url="enTestVid01")
        self.assertIsNone(data["translationError"])
        phrasal = {item["phrase"] for item in data["phrasal"]}
        self.assertTrue({"pick up", "give up"} <= phrasal, phrasal)
        words = words_of(data)
        self.assertEqual(words["beautiful"]["tr"], "güzel")
        self.assertEqual(words["decide"]["tr"], "karar vermek")  # fiil "to decide" diye soruldu
        self.assertTrue(words["phenomenon"]["ipa"])

    def test_almanca_kelimeler(self):
        data = self.get("/api/vocab", url="deTestVid01", lang="de")
        self.assertIsNone(data["translationError"])
        self.assertEqual(data["phrasal"], [])
        words = words_of(data)
        # isimler büyük harfle; ß'li kelime sıklıktan doğru seviyeye düşer (wordfreq ß'yi ss saklar)
        self.assertEqual(words["Straße"]["level"], "A1")
        self.assertEqual(words["Straße"]["tr"], "sokak")          # "Sokak" → ilk harf küçültüldü
        self.assertEqual(words["Bahnhof"]["tr"], "tren istasyonu")
        self.assertEqual(words["Bahnhof"]["pos"], "isim")
        # fiiller: çekimli biçimden mastar; anlam "zu <fiil>" sorgusundan (yalın "wohnen" → "canlı" olurdu)
        self.assertEqual(words["wohnen"]["tr"], "yaşamak")
        self.assertEqual(words["wohnen"]["pos"], "fiil")
        self.assertIn("glauben", words)                            # "glaube" → glauben (Glaube değil)
        self.assertIn("fahren", words)                             # "gefahren" → fahren
        self.assertIn("gucken", words)                             # cümle başındaki "Guck" isim sayılmaz
        for wrong in ("Glaube", "gefahren", "Guck", "awesome", "Hamburg"):
            self.assertNotIn(wrong, words)                         # özel ad ve İngilizce kelime atılır
        sent = [text for url, text in NET.calls("translate.googleapis.com")]
        self.assertTrue(all("sl=de" in url for url, _ in NET.calls("translate.googleapis.com")))
        self.assertTrue(any("zu+wohnen" in text for text in sent))
        self.assertIn("zu wohnen", self.cached("de/translations.json"))

    def test_ispanyolca_kelimeler(self):
        words = words_of(self.get("/api/vocab", url="esTestVid01", lang="es"))
        self.assertEqual(words["estación"]["tr"], "istasyon")
        self.assertIn("vivir", words)                              # "vive" → vivir

    def test_ceviri_hatasi_onbellege_alinmaz(self):
        NET.translate_status = 503
        data = self.get("/api/vocab", url="deTestVid02", lang="de")
        self.assertIsNotNone(data["translationError"])
        NET.translate_status = 0
        data = self.get("/api/vocab", url="deTestVid02", lang="de")
        self.assertIsNone(data["translationError"])
        self.assertEqual(words_of(data)["Wetter"]["tr"], "hava")


class WordToolTests(ApiTest):
    def test_heceleme(self):
        de = self.get("/api/syllables", word="Entscheidung", lang="de")
        self.assertEqual(de["word"], "entscheidung")
        self.assertEqual(len(de["syllables"]), 3)
        self.assertEqual([part["stress"] for part in de["syllables"]].count(1), 1)
        self.assertEqual(len(self.get("/api/syllables", word="estación", lang="es")["syllables"]), 3)
        self.assertEqual(len(self.get("/api/syllables", word="beautiful")["syllables"]), 3)
        self.get("/api/syllables", 400, word="zwei Wörter", lang="de")

    def test_videolarda_gecen_yerler(self):
        self.get("/api/transcript", url="deTestVid01", lang="de")
        data = self.get("/api/occurrences", word="fahren", lang="de")
        self.assertIn("gefahren", data["forms"])
        self.assertEqual(data["total"], 1)
        hit = data["videos"][0]["hits"][0]
        self.assertEqual(data["videos"][0]["videoId"], "deTestVid01")
        self.assertEqual(hit["text"][hit["span"][0]:hit["span"][1]], "gefahren")
        # İngilizce aramada Almanca videolar görünmez
        self.assertEqual(self.get("/api/occurrences", word="fahren")["total"], 0)
        self.get("/api/occurrences", 400, word="  ")

    def test_cumle_cevirisi(self):
        self.assertEqual(self.get("/api/translate", text="Guten Morgen", lang="de")["tr"], "tr Guten Morgen")
        self.assertIn("§Guten Morgen", self.cached("de/translations.json"))
        NET.translate_status = 429
        self.assertIn("sınırlıyor", self.get("/api/translate", 503, text="Neuer Satz", lang="de")["error"])
        self.get("/api/translate", 400, text="")


if __name__ == "__main__":
    unittest.main()
