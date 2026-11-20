// ===== Kayıtlı kelimeleri sayfalarda gösterme ve çalışma =====
// Veriyi store.js tutar. Bu dosya üç sayfada da yüklenir; her bölüm kendi kutusu sayfada varsa çalışır:
//   kartlar.html   → #studyArea    (aralıklı tekrar oturumu) + #savedCards (destedeki tüm kartlar)
//   kelimeler.html → #savedList    (aranabilir kelime defteri) + #wordAddForm (elle ekleme)
//   kitaplik.html  → #savedVideos  (videoya göre paketler)


// ===== Ortak yardımcılar =====

function savedElement(tag, className, text) {
    let element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;  // textContent: videodan gelen yazı HTML olarak çalışmaz
    }
    return element;
}

function savedEmptyMessage(text) {
    let message = savedElement("p", "saved-empty", text + " ");
    let link = savedElement("a", "", "Video sayfasına git");
    link.href = "video.html";
    message.appendChild(link);
    return message;
}

// Elle eklenen kelimenin videosu yoktur: o zaman düğme de yok (null)
function savedVideoButton(entry) {
    if (!entry.videoId) {
        return null;
    }
    let link = savedElement("a", "mini", "▶ Video");
    link.href = savedVideoLink(entry);
    link.title = "Kelimenin videoda geçtiği yeri aç";
    return link;
}

function savedNewestFirst(list) {
    return list.slice().sort((a, b) => b.addedAt - a.addedAt);
}

function savedStatusChip(entry) {
    let status = savedStatus(entry);
    return savedElement("span", `chip status-${status}`, SAVED_STATUS_NAMES[status]);
}

// "yeni" | "bugün" | "yarın" | "5 gün sonra"
function savedDueText(entry, now) {
    if (entry.reviews === 0) return "yeni";
    let days = Math.ceil((entry.due - now) / SAVED_DAY);
    if (days <= 0) return "bugün";
    if (days === 1) return "yarın";
    return `${days} gün sonra`;
}

// Videoların açılır listesi: [videoId, başlık, kelime sayısı]. Elle eklenenlerin videoId'si "".
function savedVideoGroups(entries) {
    let groups = new Map();
    for (let entry of entries) {
        let id = entry.videoId || "";
        if (!groups.has(id)) {
            groups.set(id, { id: id, title: "", count: 0 });
        }
        let group = groups.get(id);
        group.count++;
        group.title = group.title || entry.videoTitle || "";
    }
    for (let group of groups.values()) {
        group.title = group.id === "" ? "Elle eklenenler" : (group.title || `Video ${group.id}`);
    }
    return [...groups.values()];
}

// <select> içini doldurur; önceki seçim hâlâ varsa korunur
function savedFillSelect(select, options) {
    let previous = select.value;
    select.innerHTML = "";
    for (let [value, label] of options) {
        let option = savedElement("option", "", label);
        option.value = value;
        select.appendChild(option);
    }
    if (options.some(([value]) => value === previous)) {
        select.value = previous;
    }
}

function savedShortTitle(title) {
    return title.length > 42 ? title.slice(0, 40) + "…" : title;
}


// ===== Kartlar sayfası: aralıklı tekrar oturumu =====

let studyQueue = [];        // sırayla sorulacak kartların anahtarları
let studyRevealed = false;  // cevap gösterildi mi?
let studyDone = 0;          // bu oturumda bitirilen kart sayısı
let studyCram = false;      // "yine de hepsini çalış": zamanı gelmemiş kartlar da sorulur

function deckCards() {
    let cards = savedAll().filter((entry) => entry.inCards);
    let filter = document.getElementById("deckFilter");
    if (filter && filter.value !== "all") {
        cards = cards.filter((entry) => (entry.videoId || "") === filter.value);
    }
    return cards;
}

// Çalışma sırası: önce tekrar zamanı gelenler (en eskisi önce), sonra yeni kartlar (kaydedilme sırasıyla)
function studyOrder(cards) {
    let reviews = cards.filter((entry) => entry.reviews > 0).sort((a, b) => a.due - b.due);
    let fresh = cards.filter((entry) => entry.reviews === 0).sort((a, b) => a.addedAt - b.addedAt);
    return [...reviews, ...fresh];
}

function buildStudyQueue() {
    let now = Date.now();
    let cards = deckCards().filter((entry) => studyCram || savedIsDue(entry, now));
    studyQueue = studyOrder(cards).map((entry) => entry.key);
    studyRevealed = false;
    studyDone = 0;
}

function renderDeckStats() {
    let now = Date.now();
    let cards = deckCards();
    show("dueCount", cards.filter((entry) => entry.reviews > 0 && savedIsDue(entry, now)).length);
    show("newCount", cards.filter((entry) => savedStatus(entry) === "new").length);
    show("learningCount", cards.filter((entry) => savedStatus(entry) === "learning").length);
    show("learnedDeckCount", cards.filter((entry) => savedStatus(entry) === "learned").length);
}

function renderDeckFilter() {
    let select = document.getElementById("deckFilter");
    let all = savedAll().filter((entry) => entry.inCards);
    let options = [["all", `Tüm kartlar (${all.length})`]];
    for (let group of savedVideoGroups(all)) {
        options.push([group.id, `${savedShortTitle(group.title)} (${group.count})`]);
    }
    savedFillSelect(select, options);
}

// Örnek cümlede kelimeyi fosforlu kalemle işaretle ("kid" → "kids" de işaretlenir)
function exampleHtml(entry) {
    let box = savedElement("p", "study-example");
    let text = entry.example;
    let escaped = entry.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let match = entry.kind === "word" ? new RegExp(`(?<!\\p{L})${escaped}\\p{L}*`, "iu").exec(text) : null;
    if (match) {
        box.append(`“${text.slice(0, match.index)}`, savedElement("mark", "", match[0]), `${text.slice(match.index + match[0].length)}”`);
    } else {
        box.textContent = `“${text}”`;
    }
    return box;
}

function ratingButton(entry, rating, label, className) {
    let next = savedPreview(entry, rating);
    let button = savedElement("button", `rate ${className}`);
    button.type = "button";
    button.append(savedElement("span", "rate-label", label));
    button.append(savedElement("span", "rate-when", next.days === 0 ? "birazdan" : `${next.days} gün`));
    button.title = `Kısayol: ${rating}`;
    button.addEventListener("click", function () {
        rateStudyCard(rating);
    });
    return button;
}

function rateStudyCard(rating) {
    let key = studyQueue[0];
    if (key === undefined || !studyRevealed) {
        return;
    }
    savedReview(key, rating);
    studyQueue.shift();
    if (rating === 1) {
        studyQueue.push(key);  // bilinmeyen kart bu oturumun sonunda yeniden sorulur
    } else {
        studyDone++;
    }
    studyRevealed = false;
    stopClip();
    renderStudy();
    renderDeckStats();
    renderSavedCards();
}

function revealStudyCard() {
    if (studyQueue.length === 0 || studyRevealed) {
        return;
    }
    studyRevealed = true;
    renderStudy();
}

function renderStudyDone(area) {
    let all = deckCards();
    if (all.length === 0) {
        area.appendChild(savedEmptyMessage("Bu destede kart yok. Video sayfasında bir kelimenin altındaki \"＋ Kart\" düğmesine bas."));
        return;
    }
    let now = Date.now();
    let box = savedElement("div", "study-done");
    box.appendChild(savedElement("p", "study-done-title", studyDone > 0 ? "Bugünlük bu kadar!" : "Şu an tekrar edilecek kart yok."));

    let waiting = all.filter((entry) => entry.due > now).sort((a, b) => a.due - b.due);
    if (waiting.length > 0) {
        box.appendChild(savedElement("p", "", `Sıradaki tekrar: ${savedDueText(waiting[0], now)} (${waiting[0].word}).`));
    }
    let cram = savedElement("button", "ghost", `Yine de hepsini çalış (${all.length})`);
    cram.type = "button";
    cram.addEventListener("click", function () {
        studyCram = true;
        buildStudyQueue();
        renderStudy();
    });
    let more = savedElement("a", "mini", "Videodan yeni kelime ekle");
    more.href = "video.html";
    let actions = savedElement("div", "study-done-actions");
    actions.append(cram, more);
    box.appendChild(actions);
    area.appendChild(box);
}

function renderStudy() {
    let area = document.getElementById("studyArea");
    if (!area) {
        return;
    }
    area.innerHTML = "";

    // Sıradaki kartlar bu arada silinmiş ya da kartlardan çıkarılmış olabilir: onları sıradan at
    let deck = new Map(savedAll().filter((item) => item.inCards).map((item) => [item.key, item]));
    studyQueue = studyQueue.filter((key) => deck.has(key));
    let entry = studyQueue.length > 0 ? deck.get(studyQueue[0]) : null;

    show("studyCounter", entry ? `Kalan ${studyQueue.length} · biten ${studyDone}` : "");
    if (!entry) {
        stopClip();
        renderStudyDone(area);
        return;
    }

    let card = savedElement("div", "study-card");
    let meta = savedElement("div", "study-meta");
    meta.append(savedStatusChip(entry));
    let label = [entry.pos, entry.level].filter(Boolean).join(" · ");
    if (label) {
        meta.append(savedElement("span", "chip", label));
    }
    card.append(meta, savedElement("p", "study-word", entry.word));
    if (entry.ipa) {
        card.appendChild(savedElement("p", "study-ipa", `/${entry.ipa}/`));
    }
    if (entry.example) {
        card.appendChild(exampleHtml(entry));
    }

    // Video bağlantısı: cümleyi burada dinle ya da video sayfasında aç
    if (entry.videoId) {
        let videoRow = savedElement("div", "study-video");
        let listen = savedElement("button", "mini", "▶ Videodan dinle");
        listen.type = "button";
        listen.title = "Kelimenin geçtiği cümleyi videodan çal (kısayol: D)";
        listen.addEventListener("click", function () {
            playClip(entry);
        });
        let open = savedElement("a", "mini", "Videoda aç ↗");
        open.href = savedVideoLink(entry);
        open.title = entry.videoTitle || "";
        videoRow.append(listen, open);
        card.appendChild(videoRow);
    }

    if (studyRevealed) {
        card.appendChild(savedElement("p", "study-answer", entry.tr || "—"));
    }
    area.appendChild(card);

    let actions = savedElement("div", "study-actions");
    if (studyRevealed) {
        actions.classList.add("rating");
        actions.append(
            ratingButton(entry, 1, "Bilmedim", "again"),
            ratingButton(entry, 2, "Zor", "hard"),
            ratingButton(entry, 3, "Bildim", "good"),
            ratingButton(entry, 4, "Kolay", "easy")
        );
    } else {
        let reveal = savedElement("button", "", "Cevabı göster");
        reveal.type = "button";
        reveal.title = "Kısayol: Boşluk";
        reveal.addEventListener("click", revealStudyCard);
        actions.appendChild(reveal);
    }
    area.appendChild(actions);
}


// ----- Karttaki cümleyi YouTube'dan çalma -----

let clipPlayer = null;
let clipApiReady = null;  // yalnızca kartlar.html'de: YouTube IFrame API hazır olunca çözülür

function clipRange(entry) {
    let start = entry.clipStart !== undefined ? entry.clipStart : (entry.start || 0);
    let end = entry.clipEnd !== undefined ? entry.clipEnd : start + 6;
    return { videoId: entry.videoId, startSeconds: Math.max(0, start - 0.2), endSeconds: Math.max(end, start + 1) };
}

async function playClip(entry) {
    let box = document.getElementById("clipBox");
    if (!box || clipApiReady === null) {
        return;
    }
    box.hidden = false;
    let clip = clipRange(entry);
    await clipApiReady;

    if (clipPlayer === null) {
        clipPlayer = new YT.Player("clipPlayer", {
            videoId: clip.videoId,
            playerVars: { playsinline: 1, rel: 0, origin: location.origin },
            events: {
                onReady: function () {
                    clipPlayer.loadVideoById(clip);  // cümlenin başından sonuna kadar çalar
                }
            }
        });
    } else if (typeof clipPlayer.loadVideoById === "function") {
        clipPlayer.loadVideoById(clip);
    }
}

function stopClip() {
    let box = document.getElementById("clipBox");
    if (box) {
        box.hidden = true;
    }
    if (clipPlayer !== null && typeof clipPlayer.pauseVideo === "function") {
        clipPlayer.pauseVideo();
    }
}


// ----- Destedeki tüm kartlar -----

function renderSavedCards() {
    let container = document.getElementById("savedCards");
    if (!container) {
        return;
    }
    let now = Date.now();
    let cards = deckCards().sort((a, b) => a.word.localeCompare(b.word));
    container.innerHTML = "";

    for (let entry of cards) {
        let row = savedElement("li", "saved-row");
        let text = savedElement("span", "saved-text");
        text.append(savedElement("span", "saved-word", entry.word), ` = ${entry.tr || "—"}`);
        row.append(text, savedStatusChip(entry), savedElement("span", "saved-due", savedDueText(entry, now)));

        let remove = savedElement("button", "mini danger", "Karttan çıkar");
        remove.type = "button";
        remove.title = "Kartlardan çıkar; kelime defterde kalır";
        remove.addEventListener("click", function () {
            savedRemove(entry.key, "inCards");
            renderDeck();
        });
        row.appendChild(remove);
        container.appendChild(row);
    }
    show("savedCardsInfo", cards.length);
}

// Deste değişince (silme, filtre) her şeyi yeniden çiz; oturum sırası korunur
function renderDeck() {
    renderDeckFilter();
    renderDeckStats();
    renderStudy();
    renderSavedCards();
}

if (document.getElementById("studyArea")) {
    // YouTube IFrame API hazır olunca kendisi bu fonksiyonu çağırır (kartlar.html'de yükleniyor)
    clipApiReady = new Promise(function (resolve) {
        window.onYouTubeIframeAPIReady = resolve;
    });

    renderDeckFilter();
    buildStudyQueue();
    renderDeck();

    document.getElementById("deckFilter").addEventListener("change", function () {
        studyCram = false;
        stopClip();
        buildStudyQueue();
        renderDeckStats();
        renderStudy();
        renderSavedCards();
    });

    // Kısayollar: Boşluk/Enter cevabı göster, 1-4 puanla, D dinle
    document.addEventListener("keydown", function (event) {
        if (event.ctrlKey || event.altKey || event.metaKey || event.target.closest("input, select, textarea, button, a, summary")) {
            return;
        }
        if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            revealStudyCard();
        } else if (["1", "2", "3", "4"].includes(event.key)) {
            rateStudyCard(Number(event.key));
        } else if (event.key === "d" || event.key === "D") {
            let entry = studyQueue.length ? savedGet(studyQueue[0]) : null;
            if (entry && entry.videoId) {
                playClip(entry);
            }
        }
    });
}


// ===== Kelimeler sayfası: aranabilir kelime defteri =====

const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

function renderWordStats(all) {
    show("statTotal", all.length);
    show("statCards", all.filter((entry) => entry.inCards).length);
    show("statLearned", all.filter((entry) => savedStatus(entry) === "learned").length);
    show("statVideos", new Set(all.map((entry) => entry.videoId).filter(Boolean)).size);
}

function wordRowHtml(entry) {
    let row = savedElement("li", "saved-row");

    let text = savedElement("span", "saved-text");
    text.appendChild(savedElement("span", "saved-word", entry.word));
    if (entry.ipa) {
        text.append(" ", savedElement("span", "saved-ipa", `/${entry.ipa}/`));
    }
    text.append(` = ${entry.tr || "—"}`);
    if (entry.example) {
        text.appendChild(savedElement("span", "saved-example", `“${entry.example}”`));
    }
    row.appendChild(text);

    let label = [entry.pos, entry.level].filter(Boolean).join(" · ");
    if (label) {
        row.appendChild(savedElement("span", "chip", label));
    }
    if (entry.inCards) {
        row.appendChild(savedStatusChip(entry));
    }

    let card = savedElement("button", "mini", entry.inCards ? "✓ Kart" : "＋ Kart");
    card.type = "button";
    card.setAttribute("aria-pressed", entry.inCards);
    card.title = entry.inCards ? "Kartlardan çıkar" : "Çalışma kartlarına ekle";
    card.addEventListener("click", function () {
        if (entry.inCards) {
            savedRemove(entry.key, "inCards");
        } else {
            savedAdd(entry, "inCards");
        }
        renderSavedList();
    });

    let remove = savedElement("button", "mini danger", "✕");
    remove.type = "button";
    remove.title = "Defterden sil";
    remove.setAttribute("aria-label", `${entry.word}: defterden sil`);
    remove.addEventListener("click", function () {
        savedRemove(entry.key, "inList");
        renderSavedList();
    });

    let video = savedVideoButton(entry);
    row.append(card, ...(video ? [video] : []), remove);
    return row;
}

function renderSavedList() {
    let container = document.getElementById("savedList");
    if (!container) {
        return;
    }
    let all = savedAll();
    renderWordStats(all);

    // Video süzgecinin seçenekleri kayıtlara göre değişir
    let videoSelect = document.getElementById("wordVideo");
    let videoOptions = [["all", "Tüm videolar"]];
    for (let group of savedVideoGroups(all)) {
        videoOptions.push([group.id, `${savedShortTitle(group.title)} (${group.count})`]);
    }
    savedFillSelect(videoSelect, videoOptions);

    let search = document.getElementById("wordSearch").value.trim().toLowerCase();
    let level = document.getElementById("wordLevel").value;
    let status = document.getElementById("wordStatus").value;
    let sort = document.getElementById("wordSort").value;

    let words = all.filter(function (entry) {
        if (search && !entry.word.toLowerCase().includes(search) && !(entry.tr || "").toLowerCase().includes(search)) return false;
        if (level === "phrasal" && entry.kind !== "phrasal") return false;
        if (level !== "all" && level !== "phrasal" && entry.level !== level) return false;
        if (videoSelect.value !== "all" && (entry.videoId || "") !== videoSelect.value) return false;
        if (status === "cards" && !entry.inCards) return false;
        if (status === "nocards" && entry.inCards) return false;
        if (status === "learned" && savedStatus(entry) !== "learned") return false;
        return true;
    });

    if (sort === "az") {
        words.sort((a, b) => a.word.localeCompare(b.word));
    } else if (sort === "level") {
        // Seviyesi olmayanlar (phrasal verb, elle eklenen) sona
        let rank = (entry) => (LEVEL_ORDER.indexOf(entry.level) + 99) % 99;
        words.sort((a, b) => rank(a) - rank(b) || a.word.localeCompare(b.word));
    } else {
        words = savedNewestFirst(words);
    }

    container.innerHTML = "";
    if (all.length === 0) {
        let item = savedElement("li");
        item.appendChild(savedEmptyMessage("Defterin boş. Video sayfasında bir kelimenin altındaki \"＋ Defter\" düğmesine bas ya da aşağıdan elle ekle."));
        container.appendChild(item);
    } else if (words.length === 0) {
        container.appendChild(savedElement("li", "saved-empty", "Bu süzgeçlere uyan kelime yok."));
    }
    for (let entry of words) {
        container.appendChild(wordRowHtml(entry));
    }
    show("savedListInfo", all.length ? `${words.length} / ${all.length} kelime` : "");
}

if (document.getElementById("savedList")) {
    document.getElementById("wordSearch").addEventListener("input", renderSavedList);
    for (let id of ["wordLevel", "wordVideo", "wordStatus", "wordSort"]) {
        document.getElementById(id).addEventListener("change", renderSavedList);
    }

    // Elle kelime ekleme: videodan gelmeyen kelimeler de deftere girebilsin
    document.getElementById("wordAddForm").addEventListener("submit", function (event) {
        event.preventDefault();
        let textInput = document.getElementById("addWordText");
        let meaningInput = document.getElementById("addWordMeaning");
        let result = document.getElementById("wordAddResult");
        let text = textInput.value.trim().toLowerCase();
        let meaning = meaningInput.value.trim();
        let key = savedKey("word", text);

        result.className = "error";
        if (text === "" || meaning === "") {
            result.textContent = "Kelime ve anlam boş olamaz.";
            return;
        }
        if (savedGet(key) !== null) {
            result.textContent = `"${text}" zaten defterde var.`;
            return;
        }
        let target = document.getElementById("addWordCard").checked ? "inCards" : "inList";
        let ok = savedAdd({
            key: key, kind: "word", word: text, tr: meaning, ipa: "", pos: "", level: "",
            example: "", videoId: "", videoTitle: "", start: 0
        }, target);
        if (!ok) {
            result.textContent = "Kaydedilemedi: tarayıcı depolaması kapalı ya da dolu.";
            return;
        }
        result.textContent = `"${text}" deftere eklendi.`;
        result.className = "ok";
        textInput.value = "";
        meaningInput.value = "";
        textInput.focus();
        renderSavedList();
    });

    renderSavedList();
}


// ===== Kitaplık sayfası: videoya göre paketler =====

function renderSavedVideos() {
    let container = document.getElementById("savedVideos");
    if (!container) {
        return;
    }
    container.innerHTML = "";
    let all = savedNewestFirst(savedAll());

    if (all.length === 0) {
        container.appendChild(savedEmptyMessage("Henüz kelime kaydetmedin."));
        return;
    }

    for (let group of savedVideoGroups(all)) {
        let entries = all.filter((entry) => (entry.videoId || "") === group.id);
        let box = savedElement("div", "saved-video");

        let head = savedElement("div", "saved-video-head");
        head.appendChild(savedElement("span", "saved-video-title", group.title));
        let cardCount = entries.filter((entry) => entry.inCards).length;
        head.appendChild(savedElement("span", "saved-video-count", `${entries.length} kelime · ${cardCount} kartta`));
        if (group.id !== "") {
            let open = savedElement("a", "mini", "Videoyu aç");
            open.href = `video.html?v=${encodeURIComponent(group.id)}`;
            head.appendChild(open);
        }

        let words = savedElement("div", "saved-video-words");
        for (let entry of entries) {
            // Videolu kelime bağlantıdır; elle eklenenin gidecek yeri yoktur
            let item = savedElement(entry.videoId ? "a" : "span", "", entry.word);
            if (entry.videoId) {
                item.href = savedVideoLink(entry);
            }
            item.title = entry.tr || "—";
            words.appendChild(item);
        }

        box.append(head, words);
        container.appendChild(box);
    }
}

renderSavedVideos();


// ===== Bugün sayfası: günün özeti =====

function renderTodayHero(all, now) {
    let box = document.getElementById("todayHero");
    let display = document.getElementById("todayNext");
    box.innerHTML = "";

    let due = studyOrder(all.filter((entry) => savedIsDue(entry, now)));
    let reviewCount = due.filter((entry) => entry.reviews > 0).length;
    let newCount = due.length - reviewCount;
    let cards = all.filter((entry) => entry.inCards);

    let title = savedElement("h3");
    let text = savedElement("p");
    let action = savedElement("a", "button-link");

    if (due.length > 0) {
        title.textContent = `Bugün ${due.length} kart seni bekliyor`;
        text.textContent = `${reviewCount} tekrar, ${newCount} yeni kart. Sıradaki kelime sağda.`;
        action.textContent = "Çalışmaya başla";
        action.href = "kartlar.html";
        display.textContent = due[0].word;
    } else if (cards.length > 0) {
        let waiting = cards.filter((entry) => entry.due > now).sort((a, b) => a.due - b.due);
        title.textContent = "Bugünlük tekrar bitti";
        text.textContent = waiting.length ? `Sıradaki tekrar: ${savedDueText(waiting[0], now)}. Bu arada yeni bir videodan kelime toplayabilirsin.` : "";
        action.textContent = "Videodan kelime ekle";
        action.href = "video.html";
        display.textContent = "✓";
    } else {
        title.textContent = "Henüz çalışma kartın yok";
        text.textContent = "Bir YouTube videosu aç, öğrenmek istediğin kelimelerin altındaki \"＋ Kart\" düğmesine bas. Kartların burada ve Kartlar sayfasında görünür.";
        action.textContent = "Video sayfasına git";
        action.href = "video.html";
        display.textContent = "";
    }

    let actions = savedElement("div", "hero-actions");
    actions.appendChild(action);
    box.append(title, text, actions);
}

// Günün kelimesi: henüz öğrenilmemiş kelimelerden, gün boyunca aynı kalan bir seçim
function renderTodayWord(all) {
    let box = document.getElementById("todayWord");
    box.innerHTML = "";
    let pool = all.filter((entry) => savedStatus(entry) !== "learned");
    if (pool.length === 0) {
        pool = all;
    }
    if (pool.length === 0) {
        box.appendChild(savedEmptyMessage("Defterine kelime ekleyince her gün biri burada görünür."));
        return;
    }
    let dayNumber = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / SAVED_DAY);
    let entry = pool[dayNumber % pool.length];

    box.appendChild(savedElement("p", "wod-word", entry.word));
    if (entry.ipa) {
        box.appendChild(savedElement("p", "study-ipa", `/${entry.ipa}/`));
    }
    box.appendChild(savedElement("p", "wod-meaning", entry.tr || "—"));
    if (entry.example) {
        box.appendChild(exampleHtml(entry));
    }
    let meta = savedElement("p", "meta");
    let label = [entry.pos, entry.level].filter(Boolean).join(" · ");
    if (label) {
        meta.appendChild(savedElement("span", "chip", label));
    }
    let video = savedVideoButton(entry);
    if (video) {
        meta.appendChild(video);
    }
    box.appendChild(meta);
}

function renderTodayVideos(all) {
    let box = document.getElementById("todayVideos");
    box.innerHTML = "";
    let groups = savedVideoGroups(savedNewestFirst(all)).filter((group) => group.id !== "").slice(0, 4);
    if (groups.length === 0) {
        box.appendChild(savedEmptyMessage("Kelime kaydettiğin videolar burada listelenir."));
        return;
    }
    for (let group of groups) {
        let row = savedElement("a", "today-video");
        row.href = `video.html?v=${encodeURIComponent(group.id)}`;
        row.append(savedElement("span", "today-video-title", group.title), savedElement("span", "saved-video-count", `${group.count} kelime`));
        box.appendChild(row);
    }
}

// IELTS yol haritası çıkarıldıysa (ielts.js "ielts:profile") hedef bant ve sınava kalan gün
function renderTodayIelts() {
    let box = document.getElementById("todayIelts");
    let profile;
    try {
        profile = JSON.parse(localStorage.getItem("ielts:profile"));
    } catch (error) {
        profile = null;
    }
    if (!box || !profile || !profile.date || typeof profile.target !== "number" || !langHas("ielts")) {
        return;
    }
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    let days = Math.round((new Date(profile.date + "T00:00:00") - today) / SAVED_DAY);
    box.replaceChildren(
        savedElement("span", "today-ielts-title", `IELTS hedefin: ${profile.target.toFixed(1)}`),
        savedElement("span", "saved-video-count", days > 0 ? `sınava ${days} gün · yol haritasını aç →` : "sınav tarihi geçti · yeni tarih gir →")
    );
    box.hidden = false;
}

if (document.getElementById("todayHero")) {
    let all = savedAll();
    let now = Date.now();
    renderTodayIelts();
    renderTodayHero(all, now);
    renderTodayWord(all);
    renderTodayVideos(all);

    show("todayDone", savedStudyLog()[savedDayKey(new Date())] || 0);
    show("todayStreak", savedStreak());
    show("todayTotal", all.length);
    show("todayLearned", all.filter((entry) => savedStatus(entry) === "learned").length);
}
