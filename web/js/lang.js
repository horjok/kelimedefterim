// Dil katmanı: kullanıcının hangi dili çalıştığı (İngilizce, İspanyolca; ileride başkaları).
// helpers.js'ten hemen sonra, öbür bütün script'lerden önce yüklenir.
//
// - currentLang(): seçili dilin kodu ("en"). localStorage "lang" içinde saklanır.
// - langKey(anahtar): öğrenme verisini dile göre ayırır. İngilizce eski anahtarları kullanır ("savedWords"),
//   diğer diller önek alır ("es:savedWords"). Böylece mevcut veriye dokunulmaz, desteler birbirine karışmaz.
// - apiUrl(yol): sunucu isteğine ?lang= ekler (sunucu tarafı: backend/languages.py).
// - langTts(): tarayıcının sesli okuma dili ("en-US").
// - langHas(özellik): seçili dilde bu bölüm var mı ("grammar", "wordbank", "ielts", "phrasal", "ipa").
//   Olmayan bölümlerin menü bağlantıları gizlenir; sayfası doğrudan açılırsa bir açıklama görünür (langGatePage).
// Yeni dil eklerken buradaki LANG_INFO ile backend/languages.py içindeki LANGUAGES aynı kodu taşımalı.

const LANG_DEFAULT = "en";
const LANG_INFO = {
    // nameOf / nameOfAcc: "Bunun İngilizcesi", "İngilizcesini yaz" gibi ekli biçimler (ünlü uyumu dile göre)
    en: { name: "İngilizce", nameOf: "İngilizcesi", nameOfAcc: "İngilizcesini", native: "English", tts: "en-US",
        features: ["ipa", "phrasal", "ielts", "grammar", "wordbank", "topics"] },
    // İspanyolca: video, dikte, kelimeler, kartlar, sözlük, gramer, Pekiştir (A1–C2 + konulu listeler). IELTS yok.
    es: { name: "İspanyolca", nameOf: "İspanyolcası", nameOfAcc: "İspanyolcasını", native: "Español", tts: "es-ES",
        features: ["ipa", "grammar", "wordbank", "topics"] },
};

// Sayfa → gerektirdiği özellik (backend/app.py FEATURE_PATHS ile uyumlu)
const LANG_PAGE_FEATURES = { "pekistir.html": "wordbank", "gramer.html": "grammar", "ielts.html": "ielts" };

function currentLang() {
    try {
        let code = localStorage.getItem("lang");
        return code && LANG_INFO[code] ? code : LANG_DEFAULT;
    } catch (error) {
        return LANG_DEFAULT;
    }
}

function setLang(code) {
    if (!LANG_INFO[code] || code === currentLang()) {
        return;
    }
    try {
        localStorage.setItem("lang", code);
    } catch (error) {
        return; // depolama kapalıysa dil değiştirilemez
    }
    location.reload(); // her sayfa verisini seçili dile göre baştan yükler
}

function langKey(key) {
    let code = currentLang();
    return code === LANG_DEFAULT ? key : `${code}:${key}`;
}

function apiUrl(path) {
    return path + (path.includes("?") ? "&" : "?") + "lang=" + encodeURIComponent(currentLang());
}

function langTts() {
    return LANG_INFO[currentLang()].tts;
}

function langName() {
    return LANG_INFO[currentLang()].name;
}

function langNameOf(accusative) {
    let info = LANG_INFO[currentLang()];
    return accusative ? info.nameOfAcc : info.nameOf;
}

function langHas(feature) {
    return LANG_INFO[currentLang()].features.includes(feature);
}

// Seçili dilde olmayan bölümler: menü bağlantısı gizlenir; o sayfadaysak içerik yerine açıklama görünür
function langGatePage() {
    for (let [page, feature] of Object.entries(LANG_PAGE_FEATURES)) {
        if (langHas(feature)) {
            continue;
        }
        document.querySelectorAll(`.nav a[href="${page}"]`).forEach(function (link) { link.hidden = true; });
        let here = location.pathname.split("/").pop() || "index.html";
        let main = document.querySelector("main.main");
        if (here !== page || !main) {
            continue;
        }
        for (let child of main.children) {
            child.hidden = true;
        }
        let panel = document.createElement("section");
        panel.className = "section lang-missing";
        let title = document.createElement("h2");
        title.textContent = "Bu bölüm henüz hazır değil";
        let text = document.createElement("p");
        text.textContent = `${langName()} için bu bölüm daha yapılmadı. Video, dikte, kelimeler, kartlar ve sözlük ${langName()} ile çalışıyor.`;
        let back = document.createElement("button");
        back.type = "button";
        back.textContent = `${LANG_INFO[LANG_DEFAULT].name} çalışmaya dön`;
        back.addEventListener("click", function () { setLang(LANG_DEFAULT); });
        panel.append(title, text, back);
        main.appendChild(panel);
    }
    if (!langHas("ielts")) {
        let box = document.getElementById("todayIelts");
        if (box) {
            box.hidden = true;
        }
    }
}

// Birden çok dil varsa kenar çubuğuna dil seçimi eklenir (tek dilde görünmez).
function langRenderPicker() {
    let codes = Object.keys(LANG_INFO);
    let brand = document.querySelector(".sidebar .brand");
    if (codes.length < 2 || !brand) {
        return;
    }
    let label = document.createElement("label");
    label.className = "lang-picker";
    let caption = document.createElement("span");
    caption.textContent = "Dil";
    let select = document.createElement("select");
    select.id = "langSelect";
    codes.forEach(function (code) {
        let option = document.createElement("option");
        option.value = code;
        option.textContent = LANG_INFO[code].name;
        option.selected = code === currentLang();
        select.appendChild(option);
    });
    select.addEventListener("change", function () {
        setLang(select.value);
    });
    label.append(caption, select);
    brand.after(label);
}

document.documentElement.dataset.studyLang = currentLang();
langRenderPicker();
langGatePage();
