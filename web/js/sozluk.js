// ===== Sözlük sayfası =====
// - Tanım, okunuş, ses, örnek: Free Dictionary API (api.dictionaryapi.dev; açık, anahtarsız).
// - Cambridge Dictionary: sayfası başka sitelere gömülmeye ve otomatik çekilmeye kapalı,
//   bu yüzden içerik buraya alınmaz; aranan kelimenin Cambridge sayfası yeni sekmede açılır.
// - Türkçe anlam: sunucudaki /api/translate (Google sınırlarsa kutu boş kalır, elle yazılır).
// - Kaydetme: store.js (savedAdd, savedRemove, savedGet, savedKey).
// - Videolarda geçtiği yerler: (1) /api/occurrences → daha önce açılmış videoların transkriptleri,
//   (2) YouGlish'in resmi gömme aracı (düğmeye basınca yüklenir), (3) PlayPhrase / Yarn bağlantıları (yeni sekme).
// - Sondan başa heceleme (#wordBuildup): /api/syllables kelimeyi IPA hecelerine böler; uzun kelime sondan kurulur
//   ("bəl" → "tə·bəl" → "fər·tə·bəl" → "ˈkʌm·fər·tə·bəl"). Heceler tek tek seslendirilemez (tarayıcı IPA okuyamaz);
//   kelimenin tamamı normal ve yavaş dinlenir.
// Başka sayfalar "sozluk.html?q=kelime" ile doğrudan arama açabilir ("&hece=1" heceleme panelini de açar).

const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const DICT_CAMBRIDGE = "https://dictionary.cambridge.org/dictionary/";
const DICT_HISTORY_KEY = "dictHistory";
const DICT_HISTORY_MAX = 12;
const DICT_MAX_DEFINITIONS = 5;  // her tür için gösterilen en çok tanım

let dictRequest = 0;     // geç gelen eski cevap yeni aramanın üstüne yazmasın
let dictCurrent = null;  // { word, ipa, pos, example }

function dictElement(tag, className, text) {
    let element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;  // textContent: dışarıdan gelen yazı HTML olarak çalışmaz
    }
    return element;
}

// ----- Son aramalar -----

function dictHistory() {
    try {
        let list = JSON.parse(localStorage.getItem(langKey(DICT_HISTORY_KEY)));
        return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
    } catch (error) {
        return [];
    }
}

function dictRemember(word) {
    let list = [word, ...dictHistory().filter((item) => item !== word)].slice(0, DICT_HISTORY_MAX);
    try {
        localStorage.setItem(langKey(DICT_HISTORY_KEY), JSON.stringify(list));
    } catch (error) {
        // depolama kapalıysa geçmiş tutulmaz
    }
    dictRenderHistory();
}

function dictRenderHistory() {
    let box = document.getElementById("dictHistory");
    box.replaceChildren();
    for (let word of dictHistory()) {
        let button = dictElement("button", "mini", word);
        button.type = "button";
        button.addEventListener("click", function () { dictSearch(word); });
        box.appendChild(button);
    }
}

// ----- Arama -----

// Cambridge adreslerinde boşluk yerine tire kullanılır: "pick up" → pick-up
function dictCambridgeUrl(dictionary, word) {
    return DICT_CAMBRIDGE + dictionary + "/" + encodeURIComponent(word.replace(/\s+/g, "-"));
}

function dictSetStatus(text, className) {
    let status = document.getElementById("dictStatus");
    status.textContent = text;
    status.className = className ? `transcript-hint ${className}` : "transcript-hint";
}

function dictSearch(rawWord) {
    let word = rawWord.trim().toLowerCase().replace(/\s+/g, " ");
    if (word === "") {
        return;
    }
    let request = ++dictRequest;
    dictCurrent = { word: word, ipa: "", pos: "", example: "" };
    document.getElementById("dictText").value = word;
    document.getElementById("dictResult").hidden = false;
    document.getElementById("dictWord").textContent = word;
    document.getElementById("dictIpa").textContent = "";
    document.getElementById("dictAudio").replaceChildren();
    document.getElementById("dictMeanings").replaceChildren();
    document.getElementById("dictSource").hidden = true;
    document.getElementById("dictSaveResult").textContent = "";
    document.getElementById("dictCambridgeTr").href = dictCambridgeUrl("english-turkish", word);
    document.getElementById("dictCambridgeEn").href = dictCambridgeUrl("english", word);
    dictSetStatus("Aranıyor…");

    dictFindVideos(word, request);
    wbLoad(word, request);

    // Defterde varsa oradaki anlam, yoksa çeviri
    let saved = savedGet(dictKey());
    let trInput = document.getElementById("dictTr");
    trInput.value = saved ? saved.tr : "";
    dictPaintSave();
    if (!saved) {
        dictTranslate(word, request);
    }

    fetch(DICT_API + encodeURIComponent(word))
        .then(function (response) {
            if (response.status === 404) {
                return null;  // sözlükte yok
            }
            if (!response.ok) {
                throw new Error(`Sözlük servisi hata verdi (kod ${response.status}).`);
            }
            return response.json();
        })
        .then(function (entries) {
            if (request !== dictRequest) {
                return;
            }
            if (!Array.isArray(entries) || entries.length === 0) {
                dictSetStatus(`"${word}" bu sözlükte bulunamadı. Yazımı kontrol et ya da Cambridge'de aç.`, "error");
                return;
            }
            dictRender(entries);
            dictRemember(word);
        })
        .catch(function (error) {
            if (request !== dictRequest) {
                return;
            }
            let message = error.name === "TypeError" ? "Sözlük servisine ulaşılamadı. İnternet bağlantını kontrol et." : error.message;
            dictSetStatus(message + " Cambridge bağlantıları yine de çalışır.", "error");
            console.error("Sözlük hatası:", error);
        });
}

function dictTranslate(word, request) {
    let trInput = document.getElementById("dictTr");
    trInput.placeholder = "Çeviri getiriliyor…";
    fetch(apiUrl(`/api/translate?text=${encodeURIComponent(word)}`))
        .then(function (response) { return response.json(); })
        .then(function (data) {
            if (request !== dictRequest) {
                return;
            }
            trInput.placeholder = "Anlamı yaz";
            // Kullanıcı bu arada kendi yazdıysa üstüne yazma
            if (data.tr && trInput.value.trim() === "" && data.tr.toLowerCase() !== word) {
                trInput.value = data.tr;
            }
        })
        .catch(function () {
            if (request === dictRequest) {
                trInput.placeholder = "Çeviri alınamadı, anlamı kendin yaz";
            }
        });
}

// ----- Sonucu çizme -----

function dictAudioLabel(url) {
    if (url.includes("-uk")) return "🔊 UK";
    if (url.includes("-us")) return "🔊 US";
    if (url.includes("-au")) return "🔊 AU";
    return "🔊 Dinle";
}

function dictRender(entries) {
    // Okunuş ve sesler: bütün kayıtlardan, tekrarsız
    let ipa = "";
    let audios = [];
    for (let entry of entries) {
        for (let phonetic of entry.phonetics || []) {
            if (!ipa && phonetic.text && phonetic.text.length > 4) {
                ipa = phonetic.text;
            }
            if (phonetic.audio && !audios.includes(phonetic.audio)) {
                audios.push(phonetic.audio);
            }
        }
        if (!ipa && entry.phonetic) {
            ipa = entry.phonetic;
        }
    }
    dictCurrent.ipa = ipa;
    document.getElementById("dictIpa").textContent = ipa;

    let audioBox = document.getElementById("dictAudio");
    for (let url of audios) {
        let button = dictElement("button", "mini", dictAudioLabel(url));
        button.type = "button";
        button.addEventListener("click", function () {
            new Audio(url).play().catch(function () {
                dictSetStatus("Ses çalınamadı.", "error");
            });
        });
        audioBox.appendChild(button);
    }

    // Anlamlar: türe göre gruplar
    let container = document.getElementById("dictMeanings");
    for (let entry of entries) {
        for (let meaning of entry.meanings || []) {
            if (!dictCurrent.pos) {
                dictCurrent.pos = meaning.partOfSpeech || "";
            }
            let group = dictElement("div", "dict-meaning");
            group.appendChild(dictElement("span", "chip", meaning.partOfSpeech || ""));

            let list = dictElement("ol", "dict-definitions");
            let definitions = meaning.definitions || [];
            for (let item of definitions.slice(0, DICT_MAX_DEFINITIONS)) {
                let row = dictElement("li", "", item.definition);
                if (item.example) {
                    row.appendChild(dictElement("span", "dict-example", item.example));
                    if (!dictCurrent.example) {
                        dictCurrent.example = item.example;
                    }
                }
                list.appendChild(row);
            }
            group.appendChild(list);
            if (definitions.length > DICT_MAX_DEFINITIONS) {
                group.appendChild(dictElement("p", "lab-note", `+${definitions.length - DICT_MAX_DEFINITIONS} tanım daha var.`));
            }

            let synonyms = (meaning.synonyms || []).slice(0, 8);
            if (synonyms.length > 0) {
                let line = dictElement("div", "dict-synonyms");
                line.appendChild(dictElement("span", "dict-label", "Eş anlamlılar"));
                for (let synonym of synonyms) {
                    let button = dictElement("button", "mini", synonym);
                    button.type = "button";
                    button.addEventListener("click", function () { dictSearch(synonym); });
                    line.appendChild(button);
                }
                group.appendChild(line);
            }
            container.appendChild(group);
        }
    }
    dictSetStatus("");
    document.getElementById("dictSource").hidden = false;
}

// ----- Videolarda geçtiği yerler -----

function dictTime(seconds) {
    let total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function dictFindVideos(word, request) {
    let query = encodeURIComponent(word);
    document.getElementById("dictVideos").hidden = false;
    document.getElementById("dictPlayPhrase").href = `https://www.playphrase.me/#/search?q=${query}`;
    document.getElementById("dictYarn").href = `https://getyarn.io/yarn-find?text=${query}`;
    document.getElementById("dictYouglishSite").href = `https://youglish.com/pronounce/${query}/english`;
    dictYouglishReset();

    let status = document.getElementById("dictOwnStatus");
    let box = document.getElementById("dictOwn");
    box.replaceChildren();
    status.className = "transcript-hint";
    status.textContent = "Aranıyor…";

    fetch(apiUrl(`/api/occurrences?word=${query}`))
        .then(function (response) {
            return response.json().then(function (data) {
                if (!response.ok) {
                    throw new Error(data.error || `Sunucu hatası (kod ${response.status}).`);
                }
                return data;
            });
        })
        .then(function (data) {
            if (request !== dictRequest) {
                return;
            }
            if (data.searched === 0) {
                status.textContent = "Henüz kayıtlı video yok. Video sayfasında açtığın her video buraya eklenir.";
                return;
            }
            if (data.total === 0) {
                status.textContent = `Açtığın ${data.searched} videoda "${data.word}" geçmiyor.`;
                return;
            }
            status.textContent = `${data.videos.length} videoda ${data.total} kez geçiyor (${data.searched} video arandı). Cümleye dokun, video oradan açılsın.`;
            for (let video of data.videos) {
                box.appendChild(dictVideoHtml(video));
            }
        })
        .catch(function (error) {
            if (request !== dictRequest) {
                return;
            }
            status.className = "transcript-hint error";
            status.textContent = error.name === "TypeError" || error.name === "SyntaxError"
                ? "Sunucuya ulaşılamadı. Sunucu yeniden başlatıldı mı?"
                : error.message;
        });
}

function dictVideoHtml(video) {
    let group = dictElement("div", "dict-video");
    let head = dictElement("div", "dict-video-head");
    head.appendChild(dictElement("span", "dict-video-title", video.title || `Video ${video.videoId}`));
    head.appendChild(dictElement("span", "saved-video-count", `${video.count} kez`));
    group.appendChild(head);

    for (let hit of video.hits) {
        let row = dictElement("a", "dict-hit");
        row.href = `video.html?v=${encodeURIComponent(video.videoId)}&t=${Math.floor(hit.start)}`;
        row.appendChild(dictElement("span", "line-time", dictTime(hit.start)));
        let text = dictElement("span", "dict-hit-text");
        text.append(
            hit.text.slice(0, hit.span[0]),
            dictElement("mark", "", hit.text.slice(hit.span[0], hit.span[1])),
            hit.text.slice(hit.span[1])
        );
        row.appendChild(text);
        group.appendChild(row);
    }
    if (video.count > video.hits.length) {
        group.appendChild(dictElement("p", "lab-note", `Bu videoda ${video.count - video.hits.length} kullanım daha var.`));
    }
    return group;
}

// YouGlish gömme aracı: yalnızca düğmeye basılınca yüklenir (dış siteye istek ve ses kullanıcı isteyince başlasın)
let dictYouglishWidget = null;
let dictYouglishLoading = false;

function dictYouglishStatus(text, className) {
    let status = document.getElementById("dictYouglishStatus");
    status.textContent = text;
    status.className = className ? `transcript-hint ${className}` : "transcript-hint";
}

// Yeni arama: çalan örnek dursun, düğme yeniden görünsün
function dictYouglishReset() {
    if (dictYouglishWidget) {
        try { dictYouglishWidget.pause(); } catch (error) { /* araç henüz video yüklememiş olabilir */ }
    }
    document.getElementById("dictYouglishBox").hidden = true;
    document.getElementById("dictYouglishLoad").hidden = false;
    dictYouglishStatus("");
}

function dictYouglishFetch() {
    document.getElementById("dictYouglishBox").hidden = false;
    document.getElementById("dictYouglishLoad").hidden = true;
    dictYouglishStatus("Örnekler aranıyor…");
    dictYouglishWidget.fetch(dictCurrent.word, "english");
}

// widget.js yüklenince bu adı çağırır (YouGlish API'sinin kuralı)
function onYouglishAPIReady() {
    dictYouglishLoading = false;
    dictYouglishWidget = new YG.Widget("dictYouglish", {
        components: 4 + 8 + 16 + 64,  // başlık + altyazı + hız + kontrol düğmeleri
        captionSize: 22,
        backgroundColor: "#FFFFFF", titleColor: "#312E81", textColor: "#475569",
        captionColor: "#312E81", linkColor: "#4F46E5", markerColor: "#FACC15", queryColor: "#4F46E5",
        events: {
            onFetchDone: function (event) {
                if (event.totalResult === 0) {
                    document.getElementById("dictYouglishBox").hidden = true;
                    dictYouglishStatus(`YouGlish'te "${dictCurrent.word}" için örnek bulunamadı.`);
                } else {
                    dictYouglishStatus(`${event.totalResult} örnek bulundu.`);
                }
            },
            onError: function () {
                dictYouglishStatus("YouGlish örnekleri yüklenemedi (günlük sınır dolmuş olabilir). Aşağıdaki YouGlish bağlantısını dene.", "error");
            }
        }
    });
    if (dictCurrent) {
        dictYouglishFetch();
    }
}

function dictYouglishStart() {
    if (!dictCurrent) {
        return;
    }
    if (dictYouglishWidget) {
        dictYouglishFetch();
        return;
    }
    if (dictYouglishLoading) {
        return;
    }
    dictYouglishLoading = true;
    dictYouglishStatus("YouGlish yükleniyor…");
    let script = document.createElement("script");
    script.src = "https://youglish.com/public/emb/widget.js";
    script.async = true;
    script.onerror = function () {
        dictYouglishLoading = false;
        dictYouglishStatus("YouGlish'e ulaşılamadı. İnternet bağlantını kontrol et ya da aşağıdaki bağlantıyı dene.", "error");
    };
    document.head.appendChild(script);
}

// ----- Kelimeyi sondan başa heceleme -----

let wbSyllables = [];   // [{ ipa, stress }]
let wbStepCount = 0;    // kaç hece açık (sondan); 0 = panel kapalı
let wbAutoOpen = new URLSearchParams(location.search).get("hece") === "1";

function wbLoad(word, request) {
    wbClose();
    wbSyllables = [];
    document.getElementById("dictSyllOpen").hidden = true;
    if (word.includes(" ")) {
        return;  // yalnızca tek kelime hecelenir
    }
    fetch(apiUrl(`/api/syllables?word=${encodeURIComponent(word)}`))
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) {
            if (request !== dictRequest || !data || data.syllables.length < 2) {
                return;  // sözlükte yok ya da tek heceli: düğme görünmez
            }
            wbSyllables = data.syllables;
            document.getElementById("dictSyllOpen").hidden = false;
            if (wbAutoOpen) {
                wbAutoOpen = false;
                wbGo(1);
            }
        })
        .catch(function () { /* sunucu yoksa düğme görünmez */ });
}

function wbSyllableText(syllable) {
    let mark = syllable.stress === 1 ? "ˈ" : syllable.stress === 2 ? "ˌ" : "";
    return mark + syllable.ipa;
}

function wbRender() {
    let total = wbSyllables.length;
    let firstOpen = total - wbStepCount;
    let box = document.getElementById("wbText");
    box.replaceChildren();
    wbSyllables.forEach(function (syllable, index) {
        if (index > 0) {
            box.append(dictElement("span", "wb-dot", "·"));
        }
        let span = dictElement(index === firstOpen ? "mark" : "span", index < firstOpen ? "buildup-wait" : "buildup-say", wbSyllableText(syllable));
        if (syllable.stress === 1) {
            span.classList.add("wb-stress");
        }
        box.append(span);
    });
    document.getElementById("wbStep").textContent = `Adım ${wbStepCount} / ${total}`;
    document.getElementById("wbPrev").disabled = wbStepCount <= 1;
    document.getElementById("wbNext").disabled = wbStepCount >= total;
    document.getElementById("wbHint").textContent = wbStepCount >= total
        ? "Kelimenin tamamı. Dinle ve vurgulu heceyi (ˈ) en güçlü söyleyerek tekrar et."
        : "Koyu yazılan heceleri yüksek sesle söyle, sonra öndeki heceyi ekle. Altı çizili hece vurguludur.";
}

function wbGo(step) {
    if (wbSyllables.length < 2) {
        return;
    }
    wbStepCount = Math.min(wbSyllables.length, Math.max(1, step));
    document.getElementById("wordBuildup").hidden = false;
    document.getElementById("dictSyllOpen").setAttribute("aria-pressed", "true");
    wbRender();
}

function wbClose() {
    wbStepCount = 0;
    if ("speechSynthesis" in window) {
        speechSynthesis.cancel();
    }
    document.getElementById("wordBuildup").hidden = true;
    document.getElementById("dictSyllOpen").setAttribute("aria-pressed", "false");
}

function wbSpeak(rate) {
    if (!dictCurrent) {
        return;
    }
    if (!("speechSynthesis" in window)) {
        document.getElementById("wbHint").textContent = "Tarayıcın sesli okumayı desteklemiyor; yukarıdaki 🔊 düğmelerini dene.";
        return;
    }
    speechSynthesis.cancel();
    let speech = new SpeechSynthesisUtterance(dictCurrent.word);
    speech.lang = langTts();
    speech.rate = rate;
    speechSynthesis.speak(speech);
}

// ----- Kaydetme -----

function dictKey() {
    // İki kelimeli aramalar (pick up) defterde phrasal verb olarak durur
    return savedKey(dictCurrent.word.includes(" ") ? "phrasal" : "word", dictCurrent.word);
}

function dictPaintSave() {
    let saved = dictCurrent ? savedGet(dictKey()) : null;
    let listButton = document.getElementById("dictSaveList");
    let cardButton = document.getElementById("dictSaveCard");
    listButton.setAttribute("aria-pressed", saved ? "true" : "false");
    listButton.textContent = saved ? "✓ Defterde" : "＋ Defter";
    cardButton.setAttribute("aria-pressed", saved && saved.inCards ? "true" : "false");
    cardButton.textContent = saved && saved.inCards ? "✓ Kart" : "＋ Kart";
}

// target: "inList" ya da "inCards". Basılıysa çıkarır, değilse ekler.
function dictToggleSave(target) {
    if (!dictCurrent) {
        return;
    }
    let result = document.getElementById("dictSaveResult");
    let key = dictKey();
    let saved = savedGet(key);
    let ok = true;
    result.className = "error";

    if (saved && (target === "inList" || saved.inCards)) {
        ok = savedRemove(key, target);
        result.textContent = ok ? (target === "inList" ? "Defterden silindi." : "Kartlardan çıkarıldı.") : "";
    } else {
        let meaning = document.getElementById("dictTr").value.trim();
        if (meaning === "") {
            result.textContent = "Önce Türkçe anlamını yaz.";
            document.getElementById("dictTr").focus();
            return;
        }
        let isPhrasal = dictCurrent.word.includes(" ");
        ok = savedAdd({
            key: key, kind: isPhrasal ? "phrasal" : "word", word: dictCurrent.word, tr: meaning,
            ipa: dictCurrent.ipa, pos: dictCurrent.pos, level: "",
            example: dictCurrent.example, videoId: "", videoTitle: "", start: 0
        }, target);
        result.textContent = ok ? (target === "inCards" ? "Kartlara eklendi." : "Deftere eklendi.") : "";
    }
    if (!ok) {
        result.textContent = "Kaydedilemedi: tarayıcı depolaması kapalı ya da dolu.";
    } else {
        result.className = "ok";
    }
    dictPaintSave();
}

// ----- Başlangıç -----

document.getElementById("dictForm").addEventListener("submit", function (event) {
    event.preventDefault();
    dictSearch(document.getElementById("dictText").value);
});
document.getElementById("dictSaveList").addEventListener("click", function () { dictToggleSave("inList"); });
document.getElementById("dictSaveCard").addEventListener("click", function () { dictToggleSave("inCards"); });
document.getElementById("dictYouglishLoad").addEventListener("click", dictYouglishStart);
document.getElementById("dictSyllOpen").addEventListener("click", function () {
    if (wbStepCount > 0) {
        wbClose();
    } else {
        wbGo(1);
    }
});
document.getElementById("wbPrev").addEventListener("click", function () { wbGo(wbStepCount - 1); });
document.getElementById("wbNext").addEventListener("click", function () { wbGo(wbStepCount + 1); });
document.getElementById("wbListen").addEventListener("click", function () { wbSpeak(0.9); });
document.getElementById("wbSlow").addEventListener("click", function () { wbSpeak(0.5); });
document.getElementById("wbEnd").addEventListener("click", wbClose);

dictRenderHistory();
{
    let query = new URLSearchParams(location.search).get("q");
    if (query) {
        dictSearch(query);
    }
}
