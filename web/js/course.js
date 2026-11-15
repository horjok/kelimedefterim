// Kurs dili seçimi (sol alttaki "Kurs:" açılır listesi). Tüm sayfalarda yüklenir.
// Seçim localStorage'daki "courseLanguage" anahtarında saklanır, böylece sayfa değişince korunur.
// Not: Video modülü şimdilik yalnızca İngilizce altyazıyla çalışıyor; diğer diller seçim olarak duruyor.
{
    let courseSelect = document.getElementById("courseSelect");

    if (courseSelect) {
        let saved = "";
        try { saved = localStorage.getItem("courseLanguage") || ""; } catch (error) { }

        // Kayıtlı değer listede varsa onu seç
        if (saved && courseSelect.querySelector(`option[value="${saved}"]`)) {
            courseSelect.value = saved;
        }

        courseSelect.addEventListener("change", function () {
            try { localStorage.setItem("courseLanguage", courseSelect.value); } catch (error) { }
        });
    }
}
