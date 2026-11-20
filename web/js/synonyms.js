// Eş anlamlılar paneli: Kartlar (cevap açılınca), Kelimeler (her satırda) ve Sözlük sayfalarında aynı bileşen.
// Sunucu: GET /api/synonyms?word=<kelime> → {word, senses: [{pos, tr, synonyms: [{word, tr, note, example, exampleTr}]}], unknown}
// Eş anlamlıları Gemini üretir; sunucu her kelime için bir kez sorar ve saklar, tarayıcı da bellekte tutar.
// Gerekenler: helpers.js, lang.js (apiUrl, langTts, currentLang), store.js (savedAdd, savedGet, savedKey, savedRemove).

const synCache = new Map();  // "dil:kelime" -> Promise (aynı kelime için ikinci istek gitmesin)

function synElement(tag, className, text) {
    let element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function synFetch(word) {
    let id = `${currentLang()}:${word.toLowerCase()}`;
    if (!synCache.has(id)) {
        let request = fetch(apiUrl(`/api/synonyms?word=${encodeURIComponent(word)}`))
            .then(function (response) {
                return response.json().catch(() => ({})).then(function (data) {
                    if (!response.ok) {
                        throw new Error(data.error || `Sunucu hata verdi (kod ${response.status}).`);
                    }
                    return data;
                });
            })
            .catch(function (error) {
                synCache.delete(id);  // hata kalıcı olmasın: "Yeniden dene" yeni istek atsın
                throw error.name === "TypeError" ? new Error("Sunucuya ulaşılamadı.") : error;
            });
        synCache.set(id, request);
    }
    return synCache.get(id);
}

// Örnek cümlede eş anlamlıyı <mark> ile vurgular (metin düğümleriyle; HTML yazılmaz)
function synExample(sentence, word) {
    let line = synElement("p", "syn-example");
    let escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").exec(sentence);
    if (match) {
        line.append(sentence.slice(0, match.index), synElement("mark", "", match[0]), sentence.slice(match.index + match[0].length));
    } else {
        line.textContent = sentence;
    }
    return line;
}

function synSpeak(word) {
    if (!("speechSynthesis" in window)) {
        return;
    }
    speechSynthesis.cancel();
    let speech = new SpeechSynthesisUtterance(word);
    speech.lang = langTts();
    speech.rate = 0.9;
    speechSynthesis.speak(speech);
}

// "＋ Defter" düğmesi: eş anlamlıyı kendi anlamı ve örnek cümlesiyle deftere ekler / çıkarır
function synSaveButton(synonym, pos) {
    let kind = synonym.word.includes(" ") ? "phrasal" : "word";
    let key = savedKey(kind, synonym.word);
    let button = synElement("button", "mini");
    button.type = "button";
    function paint() {
        let saved = Boolean(savedGet(key));
        button.textContent = saved ? "✓ Defterde" : "＋ Defter";
        button.setAttribute("aria-pressed", saved);
        button.title = saved ? "Defterden çıkar" : "Bu kelimeyi deftere ekle";
    }
    button.addEventListener("click", function () {
        if (savedGet(key)) {
            savedRemove(key, "inList");
        } else {
            savedAdd({ key: key, kind: kind, word: synonym.word, tr: synonym.tr, ipa: "", pos: kind === "word" ? pos : "",
                       level: "", example: synonym.example, videoId: "", videoTitle: "", start: 0 }, "inList");
        }
        paint();
        document.dispatchEvent(new CustomEvent("saved-change"));  // Kelimeler sayfası listeyi yeniler
    });
    paint();
    return button;
}

function synItem(synonym, pos) {
    let item = synElement("li", "syn-item");
    let head = synElement("div", "syn-head");
    head.appendChild(synElement("span", "syn-word", synonym.word));
    if (synonym.tr) {
        head.appendChild(synElement("span", "syn-tr", `= ${synonym.tr}`));
    }
    item.appendChild(head);
    if (synonym.note) {
        item.appendChild(synElement("p", "syn-note", synonym.note));
    }
    if (synonym.example) {
        item.appendChild(synExample(synonym.example, synonym.word));
        if (synonym.exampleTr) {
            item.appendChild(synElement("p", "syn-example-tr", synonym.exampleTr));
        }
    }

    let actions = synElement("div", "syn-actions");
    if ("speechSynthesis" in window) {
        let listen = synElement("button", "mini ico-speaker", "Dinle");
        listen.type = "button";
        listen.setAttribute("aria-label", `${synonym.word}: dinle`);
        listen.addEventListener("click", function () { synSpeak(synonym.word); });
        actions.appendChild(listen);
    }
    actions.appendChild(synSaveButton(synonym, pos));
    if (!location.pathname.endsWith("sozluk.html")) {
        let open = synElement("a", "mini", "Sözlükte aç ↗");
        open.href = `sozluk.html?q=${encodeURIComponent(synonym.word)}`;
        open.target = "_blank";
        open.rel = "noopener";
        actions.appendChild(open);
    } else {
        let search = synElement("button", "mini", "Ara");
        search.type = "button";
        search.title = "Bu kelimeyi sözlükte ara";
        search.addEventListener("click", function () {
            if (typeof dictSearch === "function") {
                dictSearch(synonym.word);
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        });
        actions.appendChild(search);
    }
    item.appendChild(actions);
    return item;
}

// meaning: kayıttaki Türkçe anlam; ona uyan anlam grubu öne alınır ve işaretlenir
function synRender(box, data, meaning) {
    box.replaceChildren();
    let senses = data.senses || [];
    if (senses.length === 0) {
        box.appendChild(synElement("p", "syn-status", data.unknown
            ? `"${data.word}" tanınmadı. Yazımını kontrol et.`
            : `"${data.word}" için yaygın bir eş anlamlı yok.`));
        return;
    }
    let wanted = (meaning || "").toLocaleLowerCase("tr").split(/[,;/]/).map((part) => part.trim()).filter((part) => part.length > 1);
    let matches = (sense) => wanted.some((part) => (sense.tr || "").toLocaleLowerCase("tr").includes(part));
    let ordered = senses.filter(matches).concat(senses.filter((sense) => !matches(sense)));

    for (let sense of ordered) {
        let group = synElement("div", "syn-sense");
        if (wanted.length && matches(sense)) {
            group.classList.add("current");
        }
        let title = synElement("p", "syn-sense-title");
        if (sense.pos) {
            title.appendChild(synElement("span", "chip", sense.pos));
        }
        title.append(` ${sense.tr ? `"${sense.tr}" anlamında` : ""}`);
        group.appendChild(title);
        let list = synElement("ul", "syn-list");
        for (let synonym of sense.synonyms) {
            list.appendChild(synItem(synonym, sense.pos));
        }
        group.appendChild(list);
        box.appendChild(group);
    }
    box.appendChild(synElement("p", "syn-credit", "Yapay zekâ (Gemini) üretimi; hata içerebilir."));
}

function synLoad(box, word, meaning) {
    box.replaceChildren(synElement("p", "syn-status", "Eş anlamlılar getiriliyor…"));
    synFetch(word)
        .then(function (data) {
            if (box.isConnected) {
                synRender(box, data, meaning);
            }
        })
        .catch(function (error) {
            let status = synElement("p", "syn-status error", error.message + " ");
            let retry = synElement("button", "mini", "Yeniden dene");
            retry.type = "button";
            retry.addEventListener("click", function () { synLoad(box, word, meaning); });
            status.appendChild(retry);
            box.replaceChildren(status);
        });
}

// Kelime için yeni bir panel döndürür (çağıran sayfa yerleştirir)
function synPanel(word, meaning) {
    let box = synElement("div", "syn-panel");
    box.setAttribute("aria-live", "polite");
    synLoad(box, word, meaning);
    return box;
}

// Aç/kapa düğmesi. Açık olup olmadığını çağıran sayfa tutar (liste yeniden çizilince panel açık kalsın diye).
function synToggleButton(isOpen, onToggle) {
    let button = synElement("button", "mini syn-toggle", "≈ Eş anlamlılar");
    button.type = "button";
    button.title = "Bu kelimenin eş anlamlılarını göster";
    button.setAttribute("aria-expanded", isOpen);
    button.addEventListener("click", onToggle);
    return button;
}
