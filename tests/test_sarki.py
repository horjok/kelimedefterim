"""Şarkı modülü: Spotify linki, LRC ayrıştırma, LRCLIB araması ve aday seçimi (sahte dış servislerle)."""

from tests.support import CACHE, NET, SONGS, ApiTest

from backend import songs


class SongUnitTests(ApiTest):
    def test_spotify_link_bicimleri(self):
        tid = "aaaaaaaaaaaaaaaaaaaaa1"
        for link in (f"https://open.spotify.com/track/{tid}", f"https://open.spotify.com/intl-tr/track/{tid}?si=abc",
                     f"open.spotify.com/track/{tid}", f"spotify:track:{tid}"):
            self.assertEqual(songs.extract_track_id(link), tid)
        for link in ("https://open.spotify.com/album/aaaaaaaaaaaaaaaaaaaaa1", "https://open.spotify.com/track/kisa",
                     "https://www.youtube.com/watch?v=enTestVid01"):
            self.assertIsNone(songs.extract_track_id(link))
        self.assertTrue(songs.is_spotify_link("https://open.spotify.com/album/x"))
        self.assertFalse(songs.is_spotify_link("https://youtu.be/enTestVid01"))
        self.assertEqual(songs.song_id(tid), "sp:" + tid)
        self.assertTrue(songs.SONG_ID.match("sp:" + tid))

    def test_bozuk_link_hata_vermez(self):
        for link in ("https://[", "http://[", "[", "", None):
            self.assertIsNone(songs.extract_track_id(link))
            self.assertFalse(songs.is_spotify_link(link))

    def test_lrc_ayristirma(self):
        rows = songs.parse_lrc("[00:01.00] ♪\n[00:05.20] I walk\n[00:09.80]   \n[00:10.00] the weather.\n[01:02.5] last line")
        self.assertEqual([r[2] for r in rows], ["I walk", "the weather.", "last line"])
        self.assertAlmostEqual(rows[0][0], 5.2); self.assertAlmostEqual(rows[0][1], 4.8)
        self.assertAlmostEqual(rows[2][0], 62.5); self.assertAlmostEqual(rows[2][1], 4.0)   # son satır 4 sn
        self.assertLessEqual(max(r[1] for r in songs.parse_lrc("[00:00.00] a\n[01:00.00] b")), 8.0)  # en çok 8 sn

    def test_lrc_birden_cok_damga(self):
        rows = songs.parse_lrc("[00:20.00][00:05.00] chorus line\n[00:10.00] verse")
        self.assertEqual([(r[0], r[2]) for r in rows], [(5.0, "chorus line"), (10.0, "verse"), (20.0, "chorus line")])

    def test_yalnizca_duz_soz_aday_degil(self):
        self.assertEqual(songs.find_lyrics("Sozsuz Parca"), [])

    def test_aday_secimi(self):
        same = songs.find_lyrics("Uydurma Sabah")
        self.assertEqual(songs.choose_candidate(same, 201.0)["duration"], 201.5)
        self.assertIsNotNone(songs.choose_candidate(same, None))   # süreler 3 sn içinde → ilki
        self.assertIsNone(songs.choose_candidate(same, 260.0))     # ±3 sn içinde aday yok
        self.assertIsNone(songs.choose_candidate(songs.find_lyrics("Ortak Ad"), 200.0))  # iki sanatçı
        self.assertNotIn("synced", songs.public_candidates(same)[0])

    def test_oembed_ve_lrclib_istekleri(self):
        meta = songs.song_meta("aaaaaaaaaaaaaaaaaaaaa1")
        self.assertEqual(meta["title"], "Uydurma Sabah")
        self.assertTrue(meta["thumbnail"])
        with self.assertRaises(songs.SongError) as bilinmeyen:
            songs.song_meta("bbbbbbbbbbbbbbbbbbbbb1")
        self.assertEqual(bilinmeyen.exception.status, 404)
        NET.spotify_down = True
        with self.assertRaises(songs.SongError) as kapali:
            songs.song_meta("aaaaaaaaaaaaaaaaaaaaa1")
        self.assertEqual(kapali.exception.status, 502)

    def test_baslik_eki_atilir(self):
        for title, expected in (("Gece - Remastered 2009", "Gece"), ("Gece - 2011 Remaster", "Gece"), ("Gece - Radio Edit", "Gece"),
                                ("Gece (feat. Biri)", "Gece"), ("Gece (with Biri) - Live", "Gece"), ("Gece [Live]", "Gece"),
                                ("Gece", "Gece"), ("(feat. Biri)", "(feat. Biri)"), ("- Live", "- Live")):
            self.assertEqual(songs.strip_title_suffix(title), expected, title)

    def test_ekli_baslik_bir_kez_daha_aranir(self):
        found = songs.find_lyrics("Remasterli Gece - Remastered 2009")
        self.assertEqual([c["id"] for c in found], [9041])
        searches = [url for url, _ in NET.calls("lrclib.net") if "/api/search" in url]
        self.assertEqual(len(searches), 2)                       # önce ham başlık, sonra eksiz
        self.assertIn("track_name=Remasterli%20Gece&", searches[1] + "&")

    def test_eksiz_baslik_tek_arama_yapar(self):
        for title in ("Uydurma Sabah", "Sozsuz Parca", "Hic Yok Boyle Parca"):   # bulunan, yalnız düz sözlü, hiç olmayan
            NET.reset()
            songs.find_lyrics(title)
            self.assertEqual(len([u for u, _ in NET.calls("lrclib.net") if "/api/search" in u]), 1, title)

    def test_bozuk_govde_ve_kesik_okuma_502(self):
        import http.client
        from unittest import mock
        for failure in (http.client.IncompleteRead(b"x"), http.client.BadStatusLine("x")):
            with mock.patch.object(songs.urllib.request, "urlopen", side_effect=failure):
                with self.assertRaises(songs.SongError) as error:
                    songs.find_lyrics("Uydurma Sabah")
            self.assertEqual(error.exception.status, 502)

    def test_tek_kayit_getirme(self):
        entry = songs.fetch_lyrics(9002)
        self.assertEqual(entry["id"], 9002)
        self.assertEqual(entry["duration"], 201.5)
        self.assertIn("station", entry["synced"])
        for missing in (9021, 424242):  # yalnızca düz söz / yok
            with self.assertRaises(songs.SongError) as error:
                songs.fetch_lyrics(missing)
            self.assertEqual(error.exception.status, 404)


SP1 = "https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa1"


class SongApiTests(ApiTest):
    def setUp(self):
        super().setUp()
        # Önbellekler süreç boyunca kalır: her test şarkıları sıfırdan açsın
        from backend import grammar, languages, transcripts
        from backend.app import vocab_cache
        for track in SONGS:
            sid = "sp:" + track
            for lang in ("en", "es", "de"):
                transcripts.cache_for(lang).pop(sid, None)
                vocab_cache.pop((lang, sid), None)
                grammar.forget(sid, lang)
                path = CACHE / languages.storage_name(lang, "transcripts") / f"sp_{track}.json"
                if path.exists():
                    path.unlink()

    def test_sarki_acilir_ve_onbellege_yazilir(self):
        data = self.get("/api/song", url=SP1, duration=200.4)
        self.assertEqual(data["videoId"], "sp:aaaaaaaaaaaaaaaaaaaaa1")
        self.assertEqual(data["kind"], "song")
        self.assertIn(" – Uydurma Sabah", data["title"])
        self.assertTrue(data["lines"][0]["words"][0]["ipa"])
        self.assertIsNotNone(self.cached("transcripts/sp_aaaaaaaaaaaaaaaaaaaaa1.json"))
        NET.reset()
        self.get("/api/song", url=SP1)                         # ikinci istek: ağ yok
        self.assertEqual(NET.requests, [])

    def test_basliginda_ek_olan_sarki_acilir(self):
        data = self.get("/api/song", url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa5")
        self.assertEqual(data["lrclibId"], 9041)
        self.assertIn("lamps", data["lines"][0]["text"])

    def test_cok_sanatci_secim_ister(self):
        data = self.get("/api/song", url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa2", duration=200)
        self.assertTrue(data["choose"])
        self.assertEqual(len({c["artist"] for c in data["candidates"]}), 2)
        chosen = self.get("/api/song", url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa2",
                          lyrics=data["candidates"][1]["id"])
        self.assertEqual(chosen["lrclibId"], data["candidates"][1]["id"])

    def test_baska_soz_secimi_ustune_yazar(self):
        first = self.get("/api/song", url=SP1, duration=200.0)
        vocab_before = self.get("/api/vocab", url=SP1)
        other = [c for c in self.get("/api/song", url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa2",
                                     duration=1)["candidates"]][0]
        again = self.get("/api/song", url=SP1, lyrics=other["id"])
        self.assertNotEqual(again["lines"][0]["text"], first["lines"][0]["text"])
        self.assertEqual(self.cached("transcripts/sp_aaaaaaaaaaaaaaaaaaaaa1.json")["lrclibId"], other["id"])
        self.assertNotEqual(self.get("/api/vocab", url=SP1), vocab_before)   # eski kelime listesi kalmadı

    def test_baska_soz_secimi_kayitli_gramer_analizini_siler(self):
        key = "sp:aaaaaaaaaaaaaaaaaaaaa1"
        self.get("/api/song", url=SP1, duration=200.0)
        self.assertTrue(self.get("/api/grammar", url=SP1)["topics"])
        self.assertIn(key, self.cached("grammar.json") or {})      # analiz depoya yazıldı
        asked = len(NET.gemini_prompts)
        self.assertGreater(asked, 0)
        self.get("/api/grammar", url=SP1)                          # ikinci istek önbellekten: yeni Gemini çağrısı yok
        self.assertEqual(len(NET.gemini_prompts), asked)

        self.get("/api/song", url=SP1, lyrics=9011)                # aynı şarkı, başka söz
        self.assertNotIn(key, self.cached("grammar.json") or {})   # eski analiz depodan silindi
        self.assertTrue(self.get("/api/grammar", url=SP1)["topics"])
        self.assertGreater(len(NET.gemini_prompts), asked)         # yeni söz için yeniden Gemini'ye soruldu

    def test_choose_onbellegi_atlar_ve_aday_listesi_doner(self):
        self.get("/api/song", url=SP1, duration=200.0)          # şarkı önbellekte
        NET.reset()
        data = self.get("/api/song", url=SP1, choose=1)          # "Başka söz seç"
        self.assertTrue(data["choose"])
        self.assertEqual({c["id"] for c in data["candidates"]}, {9001, 9002})   # tek sanatçı olsa da liste
        self.assertNotIn("lines", data)
        self.assertTrue([url for url, _ in NET.calls("lrclib.net") if "/api/search" in url])
        self.assertEqual(self.get("/api/song", 404, url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa3",
                                  choose=1)["error"], "Bu şarkının zaman damgalı sözleri bulunamadı.")

    def test_soz_yok_ve_hatali_link(self):
        self.assertEqual(self.get("/api/song", 404, url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa3")["error"],
                         "Bu şarkının zaman damgalı sözleri bulunamadı.")
        self.assertIn("Yalnızca tek bir şarkının", self.get("/api/song", 400, url="https://open.spotify.com/album/x")["error"])
        self.assertIn("geçerli bir Spotify", self.get("/api/song", 400, url="https://example.com/x")["error"])
        self.assertIn("geçerli bir Spotify", self.get("/api/song", 400, url="https://[")["error"])
        self.get("/api/song", 400, url=SP1, lyrics="abc")      # sayı olmayan söz seçimi
        self.get("/api/song", 400, url=SP1, lyrics="-5")
        self.get("/api/transcript", 404, url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaab9")  # önce /api/song

    def test_bozuk_link_400_doner_500_degil(self):
        for path in ("/api/transcript", "/api/vocab", "/api/grammar"):
            for link in ("https://[", "http://[", "["):
                self.assertIn("geçerli bir YouTube", self.get(path, 400, url=link)["error"], (path, link))

    def test_sozsuz_surum_zaman_damgali_mesaj(self):
        self.assertEqual(self.get("/api/song", 404, url=SP1, lyrics=9021)["error"],
                         "Bu sürüm için zaman damgalı söz bulunamadı.")

    def test_oembed_hatasi(self):
        NET.spotify_down = True
        self.get("/api/song", 502, url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa4")
        self.assertIsNone(self.cached("transcripts/sp_aaaaaaaaaaaaaaaaaaaaa4.json"))

    def test_kelimeler_gramer_ve_arama_sarkida(self):
        self.get("/api/song", url=SP1, duration=200.0)
        vocab = self.get("/api/vocab", url=SP1)
        self.assertIn("weather", {e["word"] for lvl in vocab["levels"].values() for e in lvl})   # station çok yaygın: "Temel" listesinde
        self.assertIn("station", {e["word"] for e in vocab["basic"]})
        self.assertTrue(self.get("/api/grammar", url=SP1)["topics"])
        hits = self.get("/api/occurrences", word="station")["videos"]
        self.assertIn("sp:aaaaaaaaaaaaaaaaaaaaa1", [v["videoId"] for v in hits])
        self.assertNotIn("sp:aaaaaaaaaaaaaaaaaaaaa1", [v["videoId"] for v in self.get("/api/ielts/videos")["videos"]])

    def test_dil_uyarisi_ve_dile_gore_klasor(self):
        es = self.get("/api/song", url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa4", lang="es", duration=180)
        self.assertFalse(es["languageWarning"])
        self.assertIsNotNone(self.cached("es/transcripts/sp_aaaaaaaaaaaaaaaaaaaaa4.json"))
        de = self.get("/api/song", url="https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa4", lang="de", duration=180)
        self.assertTrue(de["languageWarning"])

    def test_dil_uyarisi_sozun_diline_bakar(self):
        en = self.get("/api/song", url=SP1, lang="en", duration=200.0)
        self.assertFalse(en["languageWarning"])
        es = self.get("/api/song", url=SP1, lang="es", duration=200.0)   # İspanyolca çalışan biri İngilizce şarkı açtı
        self.assertTrue(es["languageWarning"])
        self.assertTrue(self.get("/api/song", url=SP1, lang="de", duration=200.0)["languageWarning"])
