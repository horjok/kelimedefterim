"""Kelime Defteri entegrasyon testleri.

Çalıştırma (proje kökünde, ek paket gerekmez):
    python -m unittest discover -s tests -v

Testler Flask uygulamasını test istemcisiyle uçtan uca çalıştırır: rotalar, dil katmanı, kelime çözümleme,
IPA, önbellek deposu (geçici klasör) gerçek koddur. Yalnızca dış servisler sahtedir (tests/support.py):
YouTube transkripti, Google çeviri, Gemini, Free Dictionary / Wiktionary, YouTube başlığı.
İnternete hiç çıkılmaz, gerçek Redis'e ve cache/ klasörüne yazılmaz, gemini_key.txt okunmaz.
"""
