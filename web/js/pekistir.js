// ===== Pekiştir sayfası: 4 yeni kelimeyi tekrar tekrar görerek, duyarak ve yazarak öğrenme =====
// Akış: seviye seç → kartlar akar (biliyorum / bilmiyorum) → bilinmeyen 4 kelime seçilir → inceleme →
//       4 aşama: Anlam (çoktan seçmeli, iki yönlü) · Telaffuz (dinle, seç) · Yazım (harf yerleştir) · Cümle (boşluk doldur).
//       Yanlış cevaplanan kelime aynı aşamanın sonunda yeniden sorulur. Sonunda kelimeler kartlara eklenir (store.js).
// Kelimeler: POST /api/wordbank { level, count, exclude, topic } (backend/wordbank.py; level "PV" = phrasal verb'ler)
// ya da "Defterim" = kayıtlı kelimeler ve phrasal verb'ler.
// Ortak parçalar quiz.js içinde: ieltsElement, ieltsApi, ieltsNorm.
// localStorage: "pekistir:level", "pekistir:known" { seviye: [bilinen kelimeler] }, "pekistir:stats" { rounds, words }.

const PK_NEEDED = 4;          // bir turda çalışılan kelime sayısı
const PK_FETCH = 12;          // hazneden bir seferde istenen kelime
const PK_STAGES = [
    { key: "meaning", name: "1 · Anlam" },
    { key: "sound", name: "2 · Telaffuz" },
    { key: "spell", name: "3 · Yazım" },
    { key: "sentence", name: "4 · Cümle" }
];

let pkLevel = "B1";
let pkTopic = "";      // kelime konusu anahtarı; boş = karışık (seviyenin bütün kelimeleri)
let pkTopics = [];     // data/kelime-konulari.json: [{ key, tr, words: { B1: [], B2: [], C1: [] } }]
const PK_LIST = "liste";  // konu seçimindeki özel değer: içe aktarılmış kendi kelime listen
const PK_PHRASAL = "PV";  // seviye düğmesindeki özel değer: phrasal verb'ler (backend/phrasal_verbs.py)
let pkList = {};       // GET /api/wordbank/sources: { name, levels: { B2: adet, C1: adet } }
let pkPool = [];       // gösterilmeyi bekleyen kelimeler
let pkSeen = [];       // bu oturumda gösterilenler (çeldirici olarak da kullanılır)
let pkCurrent = null;  // ekrandaki kart
let pkPicked = [];     // seçilen 4 kelime
let pkMistakes = {};   // kelime -> yanlış sayısı
let pkStageIndex = 0;
let pkQueue = [];      // bu aşamada sorulacak sorular
let pkQuestion = null;
let pkAsked = 0;
let pkBusy = false;    // istek sürerken ya da cevap gösterilirken tıklamalar yok sayılır

function pkRead(key, fallback) {
    try {
        let value = JSON.parse(localStorage.getItem(langKey(key)));
        return value === null || typeof value !== typeof fallback ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function pkWrite(key, value) {
    try {
        localStorage.setItem(langKey(key), JSON.stringify(value));
    } catch (error) {
        // depolama kapalıysa tercih ve bilinen kelimeler tutulmaz
    }
}

function pkShuffle(list) {
    let copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function pkShow(screen) {
    for (let id of ["pkStart", "pkBrowse", "pkStudy", "pkStage", "pkDone"]) {
        document.getElementById(id).hidden = id !== screen;
    }
    window.scrollTo({ top: 0 });
}

function pkStatus(id, text, className) {
    let status = document.getElementById(id);
    status.textContent = text;
    status.className = className ? `transcript-hint ${className}` : "transcript-hint";
}

// Kelimeyi tarayıcının sesli okumasıyla söyler (yoksa sessizce geçer)
function pkSpeak(text, rate) {
    if (!("speechSynthesis" in window)) {
        return false;
    }
    speechSynthesis.cancel();
    let speech = new SpeechSynthesisUtterance(text);
    speech.lang = langTts();
    speech.rate = rate || 0.9;
    speechSynthesis.speak(speech);
    return true;
}

function pkKnownList() {
    let known = pkRead("pekistir:known", {});
    return Array.isArray(known[pkLevel]) ? known[pkLevel] : [];
}

function pkMarkKnown(word) {
    let known = pkRead("pekistir:known", {});
    let list = Array.isArray(known[pkLevel]) ? known[pkLevel] : [];
    if (!list.includes(word)) {
        list.push(word);
    }
    known[pkLevel] = list.slice(-3000);
    pkWrite("pekistir:known", known);
}


// ----- 1. Başlangıç -----

// Seçili seviyede kelimesi olan konular (konulu listeler yalnızca B1, B2 ve C1 için var)
function pkLevelTopics() {
    return pkTopics.filter((topic) => topic.words && Array.isArray(topic.words[pkLevel]) && topic.words[pkLevel].length > 0);
}

// Geçerli konu: seçili konu bu seviyede yoksa (A1, A2, C2, Defterim) boş döner; seçim yine de saklı kalır
function pkActiveTopic() {
    if (pkTopic === PK_LIST) {
        return pkListCount() > 0 ? PK_LIST : "";
    }
    return pkLevelTopics().some((topic) => topic.key === pkTopic) ? pkTopic : "";
}

// İçe aktarılmış kendi kelime listenin bu seviyedeki kelime sayısı (liste yoksa 0)
function pkListCount() {
    return (pkList.levels && pkList.levels[pkLevel]) || 0;
}

// Konu listesini seçili seviyeye göre doldurur; o seviyede konu yoksa satırı gizler
function pkPaintTopics() {
    let topics = pkLevelTopics();
    let select = document.getElementById("pkTopic");
    document.getElementById("pkTopicRow").hidden = topics.length === 0 && pkListCount() === 0;
    select.replaceChildren();
    let all = ieltsElement("option", "", "Karışık (bütün kelimeler)");
    all.value = "";
    select.appendChild(all);
    if (pkListCount() > 0) {
        let own = ieltsElement("option", "", `${pkList.name || "Kelime listem"} (${pkListCount()})`);
        own.value = PK_LIST;
        select.appendChild(own);
    }
    for (let topic of topics) {
        let option = ieltsElement("option", "", `${topic.tr} (${topic.words[pkLevel].length})`);
        option.value = topic.key;
        select.appendChild(option);
    }
    select.value = pkActiveTopic();
}

function pkPaintStart() {
    for (let button of document.querySelectorAll("#pkLevels button")) {
        button.setAttribute("aria-pressed", button.dataset.level === pkLevel ? "true" : "false");
    }
    pkPaintTopics();
    let note = document.getElementById("pkLevelNote");
    if (pkLevel === "defter") {
        let count = savedAll().filter((entry) => entry.tr).length;
        note.textContent = `Defterindeki ${count} kelimeden bilmediklerini seçersin. En az ${PK_NEEDED} kelime gerekir.`;
    } else if (pkLevel === PK_PHRASAL) {
        let known = pkKnownList().length;
        // Anlamlar backend/phrasal_verbs.py'de elle yazıldı; örnek sözlükten, yoksa Gemini yazar (wordbank.py)
        note.textContent = "Sık kullanılan phrasal verb'ler (give up, look after, put up with…) karışık sırayla gelir. " +
            "Türkçe anlamlar elle yazıldı; örnek cümleler sözlükten gelir, eksik ya da uygunsuz olanı yapay zekâ yazar. " +
            "Yazım aşamasında kelime araları hazırdır, yalnızca harfleri yerleştirirsin." +
            (known ? ` "Biliyorum" dediğin ${known} phrasal verb yeniden gösterilmez.` : "");
    } else {
        let known = pkKnownList().length;
        let topic = pkTopics.find((entry) => entry.key === pkActiveTopic());
        let fromList = pkActiveTopic() === PK_LIST;
        // Anlam otomatik çeviri, örnek cümle sözlükten; ikisini de Gemini denetler ve düzeltir (backend/wordbank.py review_words)
        note.textContent = (fromList
            ? `${pkList.name || "Kelime listen"} içindeki ${pkLevel} kelimeleri karışık sırayla gelir.`
            : topic
                ? `"${topic.tr}" konusundaki ${pkLevel} kelimeleri karışık sırayla gelir.`
                : `${pkLevel} seviyesindeki kelimeler karışık sırayla gelir.`) +
            " Anlamlar otomatik çeviriden, örnek cümleler Wiktionary kaynaklı sözlükten gelir; yapay zekâ ikisini de denetler, yanlış anlamı düzeltir ve eksik cümleyi yazar. Yine de hata içerebilir." +
            (known ? ` Bu seviyede "biliyorum" dediğin ${known} kelime yeniden gösterilmez.` : "");
    }
    let stats = pkRead("pekistir:stats", {});
    document.getElementById("pkStats").textContent = stats.rounds
        ? `Şimdiye kadar ${stats.rounds} tur · ${stats.words} kelime pekiştirdin` : "";
}

function pkFromSaved(entry) {
    return {
        word: entry.word, tr: entry.tr, pos: entry.pos || "", ipa: entry.ipa || "", level: entry.level || "",
        example: entry.example || "", exampleTr: ""
    };
}

// Havuzu doldurur: hazneden ya da defterden. Promise döndürür.
function pkFill() {
    let skip = new Set([...pkKnownList(), ...pkSeen.map((item) => item.word), ...pkPool.map((item) => item.word)]);
    if (pkLevel === "defter") {
        // Defterdeki kelimeler ve phrasal verb'ler birlikte gelir
        let fresh = savedAll().filter((entry) => entry.tr && entry.word && !skip.has(entry.word)).map(pkFromSaved);
        pkPool.push(...pkShuffle(fresh));
        return Promise.resolve(fresh.length);
    }
    return ieltsApi("/api/wordbank", { level: pkLevel, count: PK_FETCH, exclude: [...skip], topic: pkActiveTopic() }).then(function (data) {
        let fresh = data.words.filter((item) => !skip.has(item.word));
        pkPool.push(...fresh);
        return fresh.length;
    });
}

function pkBegin() {
    if (pkBusy) {
        return;
    }
    pkBusy = true;
    pkPool = [];
    pkSeen = [];
    pkPicked = [];
    pkMistakes = {};
    pkStatus("pkStartStatus", pkLevel === "defter" ? "" : "Kelimeler hazırlanıyor… İlk seferde birkaç saniye sürebilir.");
    pkFill()
        .then(function () {
            if (pkPool.length < PK_NEEDED) {
                pkStatus("pkStartStatus", pkLevel === "defter"
                    ? `Defterinde çalışılacak en az ${PK_NEEDED} kelime yok. Video ya da Sözlük sayfasından kelime ekle ya da bir seviye seç.`
                    : "Bu seviyede yeterli yeni kelime bulunamadı.", "error");
                return;
            }
            pkStatus("pkStartStatus", "");
            pkShow("pkBrowse");
            pkNextCard();
        })
        .catch(function (error) { pkStatus("pkStartStatus", error.message, "error"); })
        .finally(function () { pkBusy = false; });
}


// ----- 2. Kartlar -----

function pkPaintDots() {
    let dots = document.getElementById("pkDots");
    dots.replaceChildren();
    for (let i = 0; i < PK_NEEDED; i++) {
        let dot = ieltsElement("span", i < pkPicked.length ? "pk-dot on" : "pk-dot", pkPicked[i] ? pkPicked[i].word : "");
        dots.appendChild(dot);
    }
}

function pkPaintCard() {
    let item = pkCurrent;
    document.getElementById("pkCardMeta").textContent = [item.level, item.pos].filter(Boolean).join(" · ") || "kelime";
    document.getElementById("pkCardWord").textContent = item.word;
    document.getElementById("pkCardIpa").textContent = item.ipa ? `/${item.ipa}/` : "";
    document.getElementById("pkCardTr").textContent = item.tr;
    document.getElementById("pkCardExample").textContent = item.example;
    document.getElementById("pkCardMeaning").hidden = true;
    document.getElementById("pkCardReveal").hidden = false;
    pkPaintDots();
}

function pkNextCard() {
    if (pkPicked.length >= PK_NEEDED) {
        pkOpenStudy();
        return;
    }
    if (pkPool.length === 0) {
        if (pkBusy) {
            return;
        }
        pkBusy = true;
        pkStatus("pkBrowseStatus", "Yeni kelimeler getiriliyor…");
        pkFill()
            .then(function (count) {
                pkBusy = false;
                if (count === 0) {
                    pkStatus("pkBrowseStatus", "Gösterilecek yeni kelime kalmadı. Başka bir seviye dene.", "error");
                    return;
                }
                pkStatus("pkBrowseStatus", "");
                pkNextCard();
            })
            .catch(function (error) {
                pkBusy = false;
                pkStatus("pkBrowseStatus", error.message, "error");
            });
        return;
    }
    pkCurrent = pkPool.shift();
    pkSeen.push(pkCurrent);
    pkPaintCard();
}

function pkReveal() {
    document.getElementById("pkCardMeaning").hidden = false;
    document.getElementById("pkCardReveal").hidden = true;
}

function pkAnswerCard(known) {
    if (!pkCurrent || pkBusy || document.getElementById("pkBrowse").hidden) {
        return;
    }
    if (known) {
        if (pkLevel !== "defter") {
            pkMarkKnown(pkCurrent.word);
        }
    } else {
        pkPicked.push(pkCurrent);
    }
    pkNextCard();
}


// ----- 3. İnceleme -----

function pkWordCard(item, extra) {
    let card = ieltsElement("div", "pk-study-item");
    let head = ieltsElement("div", "pk-study-head");
    let speak = ieltsElement("button", "mini", "🔊");
    speak.type = "button";
    speak.setAttribute("aria-label", `${item.word} kelimesini dinle`);
    speak.addEventListener("click", function () { pkSpeak(item.word); });
    head.append(ieltsElement("span", "pk-study-word", item.word), ieltsElement("span", "study-ipa", item.ipa ? `/${item.ipa}/` : ""), speak);
    card.appendChild(head);
    card.appendChild(ieltsElement("p", "pk-tr", item.tr));
    if (item.example) {
        card.appendChild(ieltsElement("p", "study-example", item.example));
    }
    if (item.exampleTr) {
        card.appendChild(ieltsElement("p", "gr-tr", item.exampleTr));
    }
    if (extra) {
        card.appendChild(extra);
    }
    return card;
}

function pkOpenStudy() {
    let list = document.getElementById("pkStudyList");
    list.replaceChildren();
    for (let item of pkPicked) {
        pkMistakes[item.word] = 0;
        list.appendChild(pkWordCard(item));
    }
    pkShow("pkStudy");
}


// ----- 4. Aşamalar -----

// Çeldirici anlamlar: önce bu turda görülen diğer kelimeler
function pkOptions(correct, field, pickedOnly) {
    let source = pickedOnly ? pkPicked : [...pkPicked, ...pkSeen, ...pkPool];
    let seenValues = new Set([ieltsNorm(correct[field])]);
    let others = [];
    for (let item of pkShuffle(source)) {
        let value = ieltsNorm(item[field]);
        if (item.word !== correct.word && item[field] && !seenValues.has(value)) {
            seenValues.add(value);
            others.push(item[field]);
        }
        if (others.length === 3) {
            break;
        }
    }
    return pkShuffle([correct[field], ...others]);
}

function pkBuildQueue(stage) {
    let words = pkShuffle(pkPicked);
    if (stage === "meaning") {
        // İki yön: önce İngilizce → Türkçe, sonra Türkçe → İngilizce
        return [...words.map((item) => ({ kind: "toTr", item })), ...pkShuffle(pkPicked).map((item) => ({ kind: "toEn", item }))];
    }
    if (stage === "sound") {
        return words.map((item) => ({ kind: "sound", item }));
    }
    if (stage === "spell") {
        return words.map((item) => ({ kind: "spell", item }));
    }
    // Cümle: örnek cümlesi olmayan kelime (elle eklenmiş olabilir) Türkçe → İngilizce sorulur
    return words.map((item) => ({ kind: pkBlank(item) ? "sentence" : "toEn", item }));
}

// Örnek cümlede kelimenin yerine boşluk koyar; kelime cümlede yoksa null
function pkBlank(item) {
    if (!item.example) {
        return null;
    }
    let pattern = new RegExp(`\\b${item.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return pattern.test(item.example) ? item.example.replace(pattern, "_____") : null;
}

function pkPaintSteps() {
    let steps = document.getElementById("pkSteps");
    steps.replaceChildren();
    PK_STAGES.forEach(function (stage, index) {
        let className = index < pkStageIndex ? "pk-step done" : index === pkStageIndex ? "pk-step on" : "pk-step";
        steps.appendChild(ieltsElement("span", className, stage.name));
    });
}

function pkStartStage(index) {
    pkStageIndex = index;
    pkQueue = pkBuildQueue(PK_STAGES[index].key);
    pkAsked = 0;
    pkPaintSteps();
    pkShow("pkStage");
    pkAsk();
}

function pkAsk() {
    if (pkQueue.length === 0) {
        if (pkStageIndex + 1 < PK_STAGES.length) {
            pkStartStage(pkStageIndex + 1);
        } else {
            pkFinish();
        }
        return;
    }
    pkBusy = false;
    pkQuestion = pkQueue.shift();
    pkAsked++;
    let item = pkQuestion.item;
    let prompt = document.getElementById("pkPrompt");
    let sub = document.getElementById("pkSub");
    let answer = document.getElementById("pkAnswer");
    let listen = document.getElementById("pkListen");
    document.getElementById("pkStageName").textContent = PK_STAGES[pkStageIndex].name;
    document.getElementById("pkStageCount").textContent = `Soru ${pkAsked} · kalan ${pkQueue.length}`;
    document.getElementById("pkFeedback").hidden = true;
    document.getElementById("pkNext").hidden = true;
    document.getElementById("pkHint").hidden = true;
    listen.hidden = true;
    prompt.className = "pk-prompt";
    answer.replaceChildren();
    sub.textContent = "";

    if (pkQuestion.kind === "toTr") {
        prompt.textContent = item.word;
        sub.textContent = "Bu kelimenin Türkçesi hangisi?";
        pkChoices(pkOptions(item, "tr", false), item.tr);
    } else if (pkQuestion.kind === "toEn") {
        prompt.textContent = item.tr;
        sub.textContent = "Bunun İngilizcesi hangisi?";
        pkChoices(pkOptions(item, "word", true), item.word);
    } else if (pkQuestion.kind === "sound") {
        let spoken = pkSpeak(item.word);
        prompt.textContent = spoken ? "🔊" : `/${item.ipa}/`;
        sub.textContent = spoken ? "Dinle: hangi kelimeyi duydun?" : "Bu okunuş hangi kelimenin?";
        listen.hidden = !spoken;
        pkChoices(pkOptions(item, "word", true), item.word);
    } else if (pkQuestion.kind === "sentence") {
        prompt.textContent = pkBlank(item);
        prompt.className = "pk-prompt pk-sentence";
        sub.textContent = "Boşluğa hangi kelime gelir?";
        pkChoices(pkOptions(item, "word", true), item.word);
    } else {
        prompt.textContent = item.tr;
        sub.textContent = "Harflere dokunarak (ya da klavyeyle) İngilizcesini yaz.";
        listen.hidden = !("speechSynthesis" in window);
        pkTiles(item);
    }
}

// Cevap verildi: doğruysa kısa bir süre sonra kendiliğinden, yanlışsa "Devam" ile ilerler
function pkResolve(right, given) {
    if (pkBusy) {
        return;
    }
    pkBusy = true;
    let item = pkQuestion.item;
    let feedback = document.getElementById("pkFeedback");
    feedback.replaceChildren();
    feedback.hidden = false;
    feedback.className = right ? "pk-feedback right" : "pk-feedback wrong";
    let line = ieltsElement("p", "pk-feedback-line");
    line.append(right ? "✓ Doğru: " : "✗ Doğrusu: ", ieltsElement("b", "", item.word), ` = ${item.tr}`);
    if (item.ipa) {
        line.append(ieltsElement("span", "study-ipa", `  /${item.ipa}/`));
    }
    feedback.appendChild(line);
    if (pkQuestion.kind === "sentence") {
        feedback.appendChild(ieltsElement("p", "study-example", item.example));
        if (item.exampleTr) {
            feedback.appendChild(ieltsElement("p", "gr-tr", item.exampleTr));
        }
    }
    if (pkQuestion.kind === "sound" || pkQuestion.kind === "spell") {
        feedback.appendChild(ieltsElement("p", "lab-note", "Şimdi kelimeyi sesli söyle."));
        pkSpeak(item.word);
    }
    if (!right) {
        pkMistakes[item.word] = (pkMistakes[item.word] || 0) + 1;
        pkQueue.push(pkQuestion);  // yanlış yapılan kelime bu aşamanın sonunda yeniden sorulur
        if (given) {
            feedback.appendChild(ieltsElement("p", "lab-note", `Senin cevabın: ${given}`));
        }
        document.getElementById("pkNext").hidden = false;
        document.getElementById("pkNext").focus();
    } else {
        setTimeout(pkAsk, pkQuestion.kind === "sentence" ? 2200 : 1300);
    }
    document.getElementById("pkHint").hidden = true;
}

function pkChoices(options, correct) {
    let box = document.getElementById("pkAnswer");
    let group = ieltsElement("div", "ielts-options pk-options");
    for (let option of options) {
        let button = ieltsElement("button", "ielts-option", option);
        button.type = "button";
        button.addEventListener("click", function () {
            if (pkBusy) {
                return;
            }
            let right = ieltsNorm(option) === ieltsNorm(correct);
            for (let other of group.children) {
                other.disabled = true;
                if (ieltsNorm(other.textContent) === ieltsNorm(correct)) {
                    other.classList.add("answer");
                }
            }
            if (!right) {
                button.classList.add("pk-wrong");
            }
            pkResolve(right, right ? "" : option);
        });
        group.appendChild(button);
    }
    box.appendChild(group);
}

// Phrasal verb gibi çok kelimeli ifadeler: "give up" → harfler "giveup", boşluk kutucuk olmaz.
// Yazılan harfleri kelime sınırlarından yeniden böler: ("giveup", "give up") → "give up"
function pkSpaced(typed, phrase) {
    let parts = [];
    let at = 0;
    for (let piece of phrase.split(" ")) {
        parts.push(typed.slice(at, at + piece.length));
        at += piece.length;
    }
    return parts.join(" ");
}

// Yazım: karışık harf kutucukları. Dokununca sıradaki boş yere gider; yerleşmiş harfe dokununca geri döner.
// Çok kelimeli ifadede boş yerler kelime kelime gruplanır, harfler yine tek sırayla dolar.
function pkTiles(item) {
    let box = document.getElementById("pkAnswer");
    let word = item.word.replace(/\s+/g, "");
    let groups = item.word.split(/\s+/).map((piece) => piece.length);
    let letters = pkShuffle(word.split(""));
    if (letters.join("") === word && word.length > 1) {
        letters.reverse();
    }
    // 7 harften uzun bir kelime grubu telefonda tek satıra sığsın diye kutucuklar küçülür
    let slots = ieltsElement("div", groups.length > 1 && Math.max(...groups) > 6 ? "pk-slots long" : "pk-slots");
    let bank = ieltsElement("div", "pk-bank");
    let placed = [];   // yerleşen kutucuklar, sırayla
    let tiles = letters.map(function (letter) {
        let tile = ieltsElement("button", "pk-tile", letter);
        tile.type = "button";
        tile.addEventListener("click", function () { place(tile); });
        bank.appendChild(tile);
        return tile;
    });

    function paint() {
        slots.replaceChildren();
        let group = null;
        let left = 0;  // geçerli kelime grubunda kalan boş yer
        let groupIndex = 0;
        for (let i = 0; i < word.length; i++) {
            if (left === 0) {
                group = ieltsElement("span", "pk-slot-word");
                slots.appendChild(group);
                left = groups[groupIndex++];
            }
            left--;
            let slot = ieltsElement("button", placed[i] ? "pk-slot filled" : "pk-slot", placed[i] ? placed[i].textContent : "");
            slot.type = "button";
            slot.setAttribute("aria-label", placed[i] ? `${placed[i].textContent} harfini geri al` : "boş");
            if (placed[i]) {
                slot.addEventListener("click", function () {
                    if (pkBusy) {
                        return;
                    }
                    let tile = placed.splice(i, 1)[0];
                    tile.disabled = false;
                    paint();
                });
            }
            group.appendChild(slot);
        }
    }

    function place(tile) {
        if (pkBusy || tile.disabled || placed.length >= word.length) {
            return;
        }
        placed.push(tile);
        tile.disabled = true;
        paint();
        if (placed.length === word.length) {
            let typed = placed.map((entry) => entry.textContent).join("");
            pkResolve(typed === word, typed === word ? "" : pkSpaced(typed, item.word));
        }
    }

    // Klavye: harfe basınca o harfin boştaki ilk kutucuğu yerleşir; Backspace son harfi geri alır
    pkTileKey = function (event) {
        if (pkBusy) {
            return;
        }
        if (event.key === "Backspace" && placed.length) {
            placed.pop().disabled = false;
            paint();
            event.preventDefault();
            return;
        }
        if (event.key === " ") {
            event.preventDefault();  // çok kelimeli ifadede boşluk yazılmaz; kelime araları hazır
            return;
        }
        let tile = tiles.find((entry) => !entry.disabled && entry.textContent === event.key.toLowerCase());
        if (tile) {
            place(tile);
        }
    };

    let hint = document.getElementById("pkHint");
    hint.hidden = false;
    hint.onclick = function () {
        if (pkBusy) {
            return;
        }
        // Yanlış yerleşmiş harfleri geri al, sonra sıradaki doğru harfi koy; ipucu yanlış sayılır
        while (placed.length && placed.map((entry) => entry.textContent).join("") !== word.slice(0, placed.length)) {
            placed.pop().disabled = false;
        }
        pkMistakes[item.word] = (pkMistakes[item.word] || 0) + 1;
        let tile = tiles.find((entry) => !entry.disabled && entry.textContent === word[placed.length]);
        if (tile) {
            place(tile);
        } else {
            paint();
        }
    };

    paint();
    box.append(slots, bank);
}

let pkTileKey = null;  // Yazım aşamasında klavye dinleyicisi (pkTiles kurar)


// ----- 5. Sonuç -----

function pkFinish() {
    pkTileKey = null;
    let list = document.getElementById("pkDoneList");
    list.replaceChildren();
    let added = 0;
    let clean = 0;
    for (let item of pkPicked) {
        let mistakes = pkMistakes[item.word] || 0;
        if (mistakes === 0) {
            clean++;
        }
        let chip = ieltsElement("span", mistakes === 0 ? "chip status-learned" : "chip status-learning",
            mistakes === 0 ? "hatasız" : `${mistakes} yanlış ya da ipucu`);
        list.appendChild(pkWordCard(item, chip));
        // Unutmamak için: kelime deftere ve kartlara eklenir; aralıklı tekrar Kartlar sayfasında sürer
        // Boşluklu ifade (phrasal verb) defterde video sayfasındaki gibi "phrasal" türüyle saklanır (anahtar p:…)
        let kind = item.word.includes(" ") ? "phrasal" : "word";
        let key = savedKey(kind, item.word);
        let existing = savedGet(key);
        if (!existing || !existing.inCards) {
            let ok = savedAdd({
                key: key, kind: kind, word: item.word, tr: item.tr, ipa: item.ipa,
                pos: kind === "phrasal" ? "phrasal verb" : item.pos, level: kind === "phrasal" ? "" : item.level,
                example: item.example, videoId: "", videoTitle: "", start: 0
            }, "inCards");
            if (ok) {
                added++;
            }
        }
    }
    let stats = pkRead("pekistir:stats", {});
    pkWrite("pekistir:stats", { rounds: (stats.rounds || 0) + 1, words: (stats.words || 0) + pkPicked.length });
    document.getElementById("pkDoneText").textContent =
        `${pkPicked.length} kelimeyi dört aşamada çalıştın; ${clean} tanesinde hiç yanlış yapmadın. ` +
        "Yanlış yaptığın kelimeleri aşağıdan bir kez daha oku ve dinle.";
    document.getElementById("pkDoneSaved").textContent = added
        ? `${added} kelime kartlarına eklendi. Unutmamak için Kartlar sayfasında aralıklı tekrarla karşına çıkacak.`
        : "Bu kelimeler zaten kartlarında; Kartlar sayfasında tekrar etmeye devam et.";
    pkShow("pkDone");
}


// ----- Başlangıç -----

for (let button of document.querySelectorAll("#pkLevels button")) {
    button.addEventListener("click", function () {
        pkLevel = button.dataset.level;
        pkWrite("pekistir:level", pkLevel);
        pkStatus("pkStartStatus", "");
        pkPaintStart();
    });
}
document.getElementById("pkTopic").addEventListener("change", function (event) {
    pkTopic = event.target.value;
    pkWrite("pekistir:topic", pkTopic);
    pkStatus("pkStartStatus", "");
    pkPaintStart();
});
document.getElementById("pkBegin").addEventListener("click", pkBegin);
document.getElementById("pkKnow").addEventListener("click", function () { pkAnswerCard(true); });
document.getElementById("pkPick").addEventListener("click", function () { pkAnswerCard(false); });
document.getElementById("pkCardReveal").addEventListener("click", pkReveal);
document.getElementById("pkCardSpeak").addEventListener("click", function () {
    if (pkCurrent && !pkSpeak(pkCurrent.word)) {
        pkStatus("pkBrowseStatus", "Tarayıcın sesli okumayı desteklemiyor.", "error");
    }
});
document.getElementById("pkQuitBrowse").addEventListener("click", function () {
    pkPaintStart();
    pkShow("pkStart");
});
document.getElementById("pkStartStages").addEventListener("click", function () { pkStartStage(0); });
document.getElementById("pkNext").addEventListener("click", pkAsk);
document.getElementById("pkListen").addEventListener("click", function () {
    if (pkQuestion) {
        pkSpeak(pkQuestion.item.word, 0.75);
    }
});
document.getElementById("pkAgain").addEventListener("click", function () {
    pkPaintStart();
    pkShow("pkStart");
    pkBegin();
});

document.addEventListener("keydown", function (event) {
    if (event.ctrlKey || event.altKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {
        return;
    }
    if (!document.getElementById("pkBrowse").hidden) {
        if (event.key === "ArrowLeft") {
            pkAnswerCard(true);
        } else if (event.key === "ArrowRight") {
            pkAnswerCard(false);
        } else if (event.key === " ") {
            pkReveal();
            event.preventDefault();
        } else if (event.key.toLowerCase() === "d" && pkCurrent) {
            pkSpeak(pkCurrent.word);
        }
    } else if (!document.getElementById("pkStage").hidden && pkTileKey && pkQuestion && pkQuestion.kind === "spell") {
        pkTileKey(event);
    }
});

{
    let saved = pkRead("pekistir:level", "B1");
    if (document.querySelector(`#pkLevels [data-level="${saved}"]`)) {
        pkLevel = saved;
    }
    pkTopic = pkRead("pekistir:topic", "");
}
pkPaintStart();

// Konulu kelime listeleri: dosya gelmezse sayfa konusuz (karışık) çalışmaya devam eder
fetch("data/kelime-konulari.json")
    .then((response) => response.json())
    .then(function (data) {
        pkTopics = Array.isArray(data.topics) ? data.topics : [];
        pkPaintStart();
    })
    .catch(function () { pkTopics = []; });

// İçe aktarılmış kelime listesi varsa konu seçimine eklenir (backend/import_wordlist.py)
fetch(apiUrl("/api/wordbank/sources"))
    .then((response) => response.json())
    .then(function (data) {
        pkList = data && typeof data === "object" ? data : {};
        pkPaintStart();
    })
    .catch(function () { pkList = {}; });
