// ===== Zaman çizgisi: İngilizcedeki 12 zaman (gramer.html#zaman-cizgisi) =====
// Kullanıcı isteği (22 Kasım 2026): zamanları kronolojik bir çizgide görmek, yapılarını ve ayırt etme ipuçlarını
// öğrenmek, düzenli çalışmak; yazdığı cümlenin öteki zamanlardaki hâllerini görmek.
// Öğrenme yöntemleri:
// - Görsel kodlama: her görünüşün (simple, continuous, perfect, perfect continuous) sabit bir şekli ve rengi var
//   (nokta, dalga, ok, dalgalı ok); çizgi, ayrıntı, sorular ve dönüştürücü aynı şekilleri kullanır (timelineDiagram).
// - Karşılaştırma: karıştırılan zaman çiftleri (data/zamanlar.json "pairs") yan yana, ayıran soruyla.
// - Geri çağırma + aralıklı tekrar: günlük tur (TL_SESSION_SIZE soru), zaman başına Leitner kutusu
//   (store.js tenseBoxes, Kartlar'la aynı aralıklar), günde en çok TL_NEW_PER_DAY yeni zaman, karışık sıralama.
// - Açıklamalı geri bildirim: her cevaptan sonra "neden" ve yanlışta iki zamanın şekli yan yana.
// - Cümle dönüştürücü: POST /api/tenses (önce kurallar, çözemezse Gemini önerilir).
// İçerik: data/zamanlar.json (özgün). localStorage: "zaman:boxes" (store.js), "zaman:daily" {date, fresh}.
// Yalnızca İngilizce (langHas("tenses")); diğer dillerde giriş kartı ve görünüm gizli.

const TL_SESSION_SIZE = 10;
const TL_NEW_PER_DAY = 3;
const TL_TIMES = [["past", "Geçmiş"], ["present", "Şimdi"], ["future", "Gelecek"]];
const TL_ASPECTS = [
    ["simple", "Simple", "nokta: olay ya da tekrar"],
    ["continuous", "Continuous", "dalga: o an süren eylem"],
    ["perfect", "Perfect", "ok: o ana kadar olmuş, sonucu o anda"],
    ["perfect-continuous", "Perfect continuous", "dalgalı ok: o ana kadar süren eylem"],
];
// Yeni zamanların öğretilme sırası (kolaydan zora)
const TL_ORDER = ["present-simple", "present-continuous", "past-simple", "past-continuous", "future-simple",
    "present-perfect", "present-perfect-continuous", "past-perfect", "future-continuous", "future-perfect",
    "past-perfect-continuous", "future-perfect-continuous"];
const TL_EXAMPLES = ["She drinks coffee every morning.", "They were playing football.", "I've finished my homework."];
const SVG_NS = "http://www.w3.org/2000/svg";

let tlData = null;          // data/zamanlar.json
let tlSelected = "";        // ayrıntısı açık zaman
let tlSession = null;       // { queue, index, results, retries }
let tlConverted = null;     // son dönüştürme sonucu
let tlPolarity = "pos";
let tlTranslations = {};    // cümle → Türkçesi (bellekte)
let tlRequest = 0;

function tlEl(tag, className, text) {
    return ieltsElement(tag, className, text);
}

function tlTense(key) {
    return tlData ? tlData.tenses.find((tense) => tense.key === key) || null : null;
}

function tlSplit(key) {
    let time = key.split("-")[0];
    return { time, aspect: key.slice(time.length + 1) };
}

function tlShuffle(list) {
    let copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}


// ----- 1. Şekiller (görsel kodlama) -----

function tlSvg(tag, attrs) {
    let node = document.createElementNS(SVG_NS, tag);
    for (let name in attrs) {
        node.setAttribute(name, attrs[name]);
    }
    return node;
}

function tlWave(x0, x1, y, amplitude) {
    let points = [];
    for (let x = x0; x <= x1 + 0.01; x += 2) {
        points.push(`${x.toFixed(1)},${(y + amplitude * Math.sin((x - x0) / 5)).toFixed(1)}`);
    }
    return points.join(" ");
}

// Zamanın şekli: çizgi (geçmiş – şimdi – gelecek) üstünde referans anı ve görünüşün şekli.
// size "mini" (kartlar) ya da "big" (ayrıntı, karşılaştırma).
function timelineDiagram(key, size) {
    let big = size === "big";
    let width = big ? 320 : 120;
    let height = big ? 86 : 44;
    let mid = big ? 46 : 24;
    let { time, aspect } = tlSplit(key);
    let ref = { past: 0.25, present: 0.5, future: 0.75 }[time] * width;
    let svg = tlSvg("svg", { viewBox: `0 0 ${width} ${height}`, class: `tl-diagram tl-${aspect}`, "aria-hidden": "true", focusable: "false" });

    svg.appendChild(tlSvg("line", { x1: 4, y1: mid, x2: width - 8, y2: mid, class: "tl-axis" }));
    svg.appendChild(tlSvg("path", { d: `M${width - 10} ${mid - 4} L${width - 3} ${mid} L${width - 10} ${mid + 4} Z`, class: "tl-axis-head" }));
    // ŞİMDİ çizgisi
    svg.appendChild(tlSvg("line", { x1: width / 2, y1: mid - (big ? 26 : 14), x2: width / 2, y2: mid + (big ? 26 : 14), class: "tl-now" }));
    if (time !== "present") {
        svg.appendChild(tlSvg("line", { x1: ref, y1: mid - (big ? 18 : 10), x2: ref, y2: mid + (big ? 18 : 10), class: "tl-ref" }));
    }
    if (big) {
        let now = tlSvg("text", { x: width / 2, y: height - 4, class: "tl-label tl-label-now", "text-anchor": "middle" });
        now.textContent = "ŞİMDİ";
        svg.appendChild(now);
        if (time !== "present") {
            let label = tlSvg("text", { x: ref, y: height - 4, class: "tl-label", "text-anchor": "middle" });
            label.textContent = time === "past" ? "geçmişte o an" : "gelecekte o an";
            svg.appendChild(label);
        }
    }

    let span = width * (big ? 0.22 : 0.28);
    let amplitude = big ? 6 : 4;
    let dot = big ? 7 : 4.5;
    if (aspect === "simple") {
        let xs = time === "present" ? [ref - span * 0.7, ref, ref + span * 0.7] : [ref];
        for (let x of xs) {
            svg.appendChild(tlSvg("circle", { cx: x, cy: mid, r: dot, class: "tl-mark" }));
        }
    } else if (aspect === "continuous") {
        svg.appendChild(tlSvg("polyline", { points: tlWave(ref - span * 0.55, ref + span * 0.55, mid, amplitude), class: "tl-line" }));
        svg.appendChild(tlSvg("circle", { cx: ref, cy: mid, r: dot * 0.55, class: "tl-mark" }));
    } else {
        let start = ref - span;
        let head = big ? 9 : 6;
        if (aspect === "perfect") {
            svg.appendChild(tlSvg("circle", { cx: start, cy: mid, r: dot * 0.8, class: "tl-mark" }));
            svg.appendChild(tlSvg("line", { x1: start, y1: mid, x2: ref - head, y2: mid, class: "tl-line" }));
        } else {
            svg.appendChild(tlSvg("polyline", { points: tlWave(start, ref - head, mid, amplitude), class: "tl-line" }));
        }
        svg.appendChild(tlSvg("path", { d: `M${ref - head} ${mid - head * 0.7} L${ref + 1} ${mid} L${ref - head} ${mid + head * 0.7} Z`, class: "tl-mark" }));
    }
    return svg;
}


// ----- 2. Çizgi ve ayrıntı -----

function tlMastery(key, boxes) {
    let entry = boxes[key];
    return entry ? Math.max(0, Math.min(5, entry.box || 0)) : -1;   // -1: henüz çalışılmadı
}

function tlRenderBoard() {
    let board = document.getElementById("tlBoard");
    let boxes = tenseBoxes();
    let now = Date.now();
    board.replaceChildren();
    board.appendChild(tlEl("span", "tl-corner"));
    for (let [, label] of TL_TIMES) {
        board.appendChild(tlEl("span", `tl-time-head${label === "Şimdi" ? " now" : ""}`, label));
    }
    for (let [aspect, name, hint] of TL_ASPECTS) {
        let head = tlEl("span", `tl-aspect-head tl-${aspect}`);
        head.append(tlEl("b", "", name), tlEl("small", "", hint));
        board.appendChild(head);
        for (let [time] of TL_TIMES) {
            let key = `${time}-${aspect}`;
            let tense = tlTense(key);
            let button = tlEl("button", `tl-cell tl-${aspect}`);
            button.type = "button";
            button.dataset.key = key;
            button.setAttribute("aria-pressed", key === tlSelected ? "true" : "false");
            button.appendChild(timelineDiagram(key, "mini"));
            button.appendChild(tlEl("span", "tl-cell-name", tense.en));
            let level = tlMastery(key, boxes);
            let state = tlEl("span", "tl-dots");
            state.setAttribute("aria-hidden", "true");
            for (let i = 1; i <= 5; i++) {
                state.appendChild(tlEl("i", i <= level ? "on" : ""));
            }
            button.appendChild(state);
            let due = boxes[key] && (boxes[key].due || 0) <= now;
            if (due) {
                button.appendChild(tlEl("span", "tl-due", "tekrar"));
            }
            button.setAttribute("aria-label", `${tense.en}, ${tense.tr}. ${level < 0 ? "Henüz çalışılmadı" : `Kutu ${level} / 5`}${due ? ", tekrar zamanı geldi" : ""}`);
            button.addEventListener("click", function () { tlSelect(key, true); });
            board.appendChild(button);
        }
    }
}

function tlPatternTable(pattern) {
    let table = tlEl("div", "tl-patterns");
    for (let [name, label] of [["pos", "Olumlu"], ["neg", "Olumsuz"], ["q", "Soru"]]) {
        let row = tlEl("div", "tl-pattern");
        row.append(tlEl("span", "tl-pattern-name", label), tlEl("code", "grammar-pattern", pattern[name]));
        table.appendChild(row);
    }
    return table;
}

function tlPair(row, en, tr) {
    let pair = tlEl("span", "gr-pair");
    pair.appendChild(tlEl("span", "gr-en", en));
    if (tr) {
        pair.appendChild(tlEl("span", "gr-tr", tr));
    }
    row.appendChild(pair);
    return row;
}

function tlSelect(key, scroll) {
    let tense = tlTense(key);
    if (!tense) {
        return;
    }
    tlSelected = key;
    for (let cell of document.querySelectorAll("#tlBoard .tl-cell")) {
        cell.setAttribute("aria-pressed", cell.dataset.key === key ? "true" : "false");
        cell.classList.remove("pair");
    }
    let box = document.getElementById("tlDetail");
    box.replaceChildren();
    let { aspect } = tlSplit(key);

    let head = tlEl("div", "tl-detail-head");
    let title = tlEl("div");
    title.append(tlEl("h3", "", tense.en), tlEl("p", "tl-detail-tr", tense.tr));
    let chips = tlEl("p", "meta");
    chips.append(tlEl("span", `chip gr-level gr-level-${tense.level}`, tense.level), tlEl("span", `chip tl-aspect-chip tl-${aspect}`, TL_ASPECTS.find((a) => a[0] === aspect)[1]));
    title.appendChild(chips);
    head.append(title, timelineDiagram(key, "big"));
    box.appendChild(head);

    box.appendChild(tlEl("p", "tl-core", tense.core));
    let turkish = tlEl("p", "tl-turkish");
    turkish.append(tlEl("b", "", "Türkçede: "), tense.turkish);
    box.appendChild(turkish);
    box.appendChild(tlPatternTable(tense.pattern));
    box.appendChild(tlPair(tlEl("p", "tl-example"), tense.example.en, tense.example.tr));

    box.appendChild(tlEl("h4", "dict-subtitle", "Ne zaman kullanılır?"));
    let uses = tlEl("ul", "ielts-list gr-uses");
    for (let use of tense.uses) {
        let item = tlEl("li");
        item.appendChild(tlEl("span", "gr-rule", use.rule));
        uses.appendChild(tlPair(item, use.en, use.tr));
    }
    box.appendChild(uses);

    box.appendChild(tlEl("h4", "dict-subtitle", "Sinyal kelimeler"));
    let signals = tlEl("p", "meta");
    for (let word of tense.signals) {
        signals.appendChild(tlEl("span", "chip", word));
    }
    box.appendChild(signals);

    let hook = tlEl("p", "ielts-note tl-hook");
    hook.append(tlEl("b", "", "Aklında kalsın: "), tense.hook);
    box.appendChild(hook);
    if (tense.warn) {
        let warn = tlEl("p", "tl-warn");
        warn.append(tlEl("b", "", "Dikkat: "), tense.warn);
        box.appendChild(warn);
    }

    let pairs = tlData.pairs.filter((pair) => pair.a === key || pair.b === key);
    if (pairs.length) {
        box.appendChild(tlEl("h4", "dict-subtitle", "Karıştırılanlar"));
        let list = tlEl("div", "tl-pair-buttons");
        for (let pair of pairs) {
            let other = tlTense(pair.a === key ? pair.b : pair.a);
            let button = tlEl("button", "mini", `${tense.en} ↔ ${other.en}`);
            button.type = "button";
            button.addEventListener("click", function () { tlComparePair(pair, button); });
            list.appendChild(button);
        }
        box.appendChild(list);
        box.appendChild(tlEl("div", "tl-compare"));
    }

    let foot = tlEl("p", "tl-detail-foot");
    let link = tlEl("a", "mini", "Konunun ayrıntılı anlatımı ve alıştırması →");
    link.href = `#${tense.topic}`;
    foot.appendChild(link);
    let entry = tenseBoxes()[key];
    foot.appendChild(tlEl("span", "lab-note", entry
        ? `Kutu ${entry.box} / 5 · ${entry.right || 0} doğru, ${entry.wrong || 0} yanlış · sıradaki tekrar ${tlDayText(entry.due)}`
        : "Bu zamanı henüz tekrar turunda çalışmadın."));
    box.appendChild(foot);
    box.hidden = false;
    if (scroll) {
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

function tlDayText(due) {
    let days = Math.ceil(((due || 0) - Date.now()) / SAVED_DAY);
    if (days <= 0) {
        return "bugün";
    }
    return days === 1 ? "yarın" : `${days} gün sonra`;
}

function tlComparePair(pair, button) {
    let box = document.querySelector("#tlDetail .tl-compare");
    for (let other of document.querySelectorAll("#tlDetail .tl-pair-buttons button")) {
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
    }
    for (let cell of document.querySelectorAll("#tlBoard .tl-cell")) {
        cell.classList.toggle("pair", cell.dataset.key === pair.a || cell.dataset.key === pair.b);
    }
    box.replaceChildren();
    let ask = tlEl("p", "tl-ask");
    ask.append(tlEl("b", "", "Ayıran soru: "), pair.ask);
    box.appendChild(ask);
    let sides = tlEl("div", "tl-compare-sides");
    for (let key of [pair.a, pair.b]) {
        let tense = tlTense(key);
        let side = tlEl("div", `tl-compare-side tl-${tlSplit(key).aspect}`);
        side.append(tlEl("b", "", tense.en), timelineDiagram(key, "big"));
        for (let example of pair.examples.filter((item) => item.tense === key)) {
            side.appendChild(tlPair(tlEl("p", "tl-example"), example.en, example.tr));
        }
        sides.appendChild(side);
    }
    box.appendChild(sides);
    let tip = tlEl("p", "ielts-note");
    tip.append(tlEl("b", "", "İpucu: "), pair.tip);
    box.appendChild(tip);
}


// ----- 3. Günlük tekrar (geri çağırma + aralıklı tekrar) -----

function tlToday() {
    return savedDayKey(new Date());
}

function tlDaily() {
    try {
        let value = JSON.parse(localStorage.getItem(langKey("zaman:daily")));
        return value && value.date === tlToday() ? value : { date: tlToday(), fresh: 0 };
    } catch (error) {
        return { date: tlToday(), fresh: 0 };
    }
}

function tlSaveDaily(value) {
    try {
        localStorage.setItem(langKey("zaman:daily"), JSON.stringify(value));
    } catch (error) { }
}

// Bu turda odaklanılacak zamanlar: önce zamanı gelenler (kutu küçükten), sonra günlük sınırla yeni zamanlar
function tlFocus(boxes, now, force) {
    let due = Object.keys(boxes).filter((key) => (boxes[key].due || 0) <= now)
        .sort((a, b) => (boxes[a].box - boxes[b].box) || (boxes[a].due - boxes[b].due));
    let room = Math.max(0, TL_NEW_PER_DAY - tlDaily().fresh);
    let fresh = TL_ORDER.filter((key) => !boxes[key]).slice(0, room);
    let focus = due.concat(fresh);
    if (focus.length === 0 && force) {
        let started = Object.keys(boxes).sort((a, b) => boxes[a].box - boxes[b].box);
        focus = (started.length ? started : TL_ORDER).slice(0, 4);
    }
    return { due, fresh, focus };
}

function tlPickQuestion(key, used, boxes) {
    let seen = (boxes[key] && boxes[key].seen) || [];
    let options = tlData.questions.filter((question) => question.tense === key && !used.has(question.id));
    if (options.length === 0) {
        return null;
    }
    // en uzun zamandır görülmeyen önce (seen listesinde önde olan = daha eski)
    options.sort((a, b) => seen.indexOf(a.id) - seen.indexOf(b.id) || Math.random() - 0.5);
    let unseen = options.filter((question) => !seen.includes(question.id));
    return tlShuffle(unseen.length ? unseen : options.slice(0, 2))[0];
}

// Aynı zaman art arda gelmesin (karışık sıralama)
// Her adımda bir öncekinden farklı ve en çok sorusu kalan zaman seçilir (yalnızca tek zaman kaldıysa art arda gelir)
function tlInterleave(list) {
    let rest = tlShuffle(list);
    let result = [];
    while (rest.length) {
        let last = result.length ? result[result.length - 1].tense : "";
        let count = {};
        for (let item of rest) {
            count[item.tense] = (count[item.tense] || 0) + 1;
        }
        let candidates = rest.filter((item) => item.tense !== last);
        let pool = candidates.length ? candidates : rest;
        let pick = pool.reduce((best, item) => (count[item.tense] > count[best.tense] ? item : best), pool[0]);
        result.push(pick);
        rest.splice(rest.indexOf(pick), 1);
    }
    return result;
}

function tlBuildSession(force) {
    let boxes = tenseBoxes();
    let { focus, fresh } = tlFocus(boxes, Date.now(), force);
    if (focus.length === 0) {
        return null;
    }
    let used = new Set();
    let queue = [];
    let add = function (key) {
        let question = queue.length < TL_SESSION_SIZE ? tlPickQuestion(key, used, boxes) : null;
        if (question) {
            used.add(question.id);
            queue.push(question);
        }
    };
    focus.forEach(add);
    // karıştırılan eşler: odaktaki zamanın eşi (ayırt etmeyi öğretir)
    for (let key of focus) {
        for (let pair of tlData.pairs.filter((item) => item.a === key || item.b === key)) {
            let other = pair.a === key ? pair.b : pair.a;
            if ((boxes[other] || focus.includes(other)) && !queue.some((question) => question.tense === other)) {
                add(other);
            }
        }
    }
    // kalan yerler: odaktaki zamanlardan ikinci sorular (yeni zamanlar önce)
    for (let round = 0; queue.length < TL_SESSION_SIZE && round < 4; round++) {
        fresh.concat(focus).forEach(add);
    }
    return { queue: tlInterleave(queue), index: 0, focus, fresh, results: {}, retries: 0, answered: false };
}

function tlRenderPracticeStart() {
    let area = document.getElementById("tlPracticeArea");
    let status = document.getElementById("tlPracticeStatus");
    let boxes = tenseBoxes();
    let { due, fresh } = tlFocus(boxes, Date.now(), false);
    area.replaceChildren();
    let start = tlEl("button", "tl-start", "Turu başlat");
    start.type = "button";
    if (due.length || fresh.length) {
        let parts = [];
        if (due.length) {
            parts.push(`${due.length} zamanın tekrarı geldi`);
        }
        if (fresh.length) {
            parts.push(`${fresh.length} yeni zaman (${fresh.map((key) => tlTense(key).en).join(", ")})`);
        }
        status.textContent = `Bugün: ${parts.join(" · ")}. Tur yaklaşık ${TL_SESSION_SIZE} soru; karıştırılan zamanlar da araya girer.`;
        start.addEventListener("click", function () { tlStartSession(false); });
        area.appendChild(start);
    } else {
        status.textContent = Object.keys(boxes).length >= TENSE_COUNT
            ? "Bugünlük tekrar yok; sıradaki tekrar zamanı gelince burada görünecek."
            : `Bugünkü ${TL_NEW_PER_DAY} yeni zamanı öğrendin. Yarın yenileri gelecek.`;
        start.textContent = "Yine de çalış";
        start.classList.add("ghost");
        start.addEventListener("click", function () { tlStartSession(true); });
        area.appendChild(start);
    }
}

function tlStartSession(force) {
    tlSession = tlBuildSession(force);
    if (!tlSession) {
        tlRenderPracticeStart();
        return;
    }
    tlRenderQuestion();
}

// **fiil** → <mark>, *sinyal* → <em>; geri kalanı düz metin
function tlRich(text) {
    let box = tlEl("span", "tl-rich");
    let pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
        if (match.index > last) {
            box.appendChild(document.createTextNode(text.slice(last, match.index)));
        }
        box.appendChild(match[1] !== undefined ? tlEl("mark", "", match[1]) : tlEl("em", "tl-signal", match[2]));
        last = pattern.lastIndex;
    }
    if (last < text.length) {
        box.appendChild(document.createTextNode(text.slice(last)));
    }
    return box;
}

const TL_TYPE_TEXT = {
    place: "Koyu yazılan fiil öbeği hangi zamanda? Çizgide yerini seç.",
    signal: "Eğik yazılan sinyale bak: koyu fiil öbeği hangi zamanda?",
    gap: "Boşluğa doğru biçimi yaz.",
    meaning: "Durumu anlatan cümleyi seç.",
};

function tlRenderQuestion() {
    let session = tlSession;
    let area = document.getElementById("tlPracticeArea");
    let question = session.queue[session.index];
    session.answered = false;
    area.replaceChildren();
    document.getElementById("tlPracticeStatus").textContent =
        `Soru ${session.index + 1} / ${session.queue.length}`;

    let progress = tlEl("div", "tl-progress");
    let bar = tlEl("span");
    bar.style.width = `${Math.round(session.index / session.queue.length * 100)}%`;
    progress.appendChild(bar);
    area.appendChild(progress);
    area.appendChild(tlEl("p", "tl-q-kind", TL_TYPE_TEXT[question.type]));

    let card = tlEl("div", "tl-q");
    if (question.type === "gap") {
        let parts = question.text.split("___");
        let line = tlEl("p", "tl-q-text");
        let input = tlEl("input", "tl-gap");
        input.type = "text";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.setAttribute("aria-label", "Boşluğa gelecek biçim");
        input.size = Math.max(8, question.answer.length + 2);
        line.append(parts[0], input, parts.slice(1).join("___"));
        card.appendChild(line);
        let check = tlEl("button", "tl-check", "Kontrol et");
        check.type = "button";
        let submit = function () {
            if (!session.answered && input.value.trim()) {
                tlAnswer(input.value, input);
            }
        };
        check.addEventListener("click", submit);
        input.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        });
        card.appendChild(check);
        area.appendChild(card);
        input.focus();
    } else if (question.type === "place") {
        card.appendChild(tlRich(question.text)).classList.add("tl-q-text");
        let grid = tlEl("div", "tl-choice-grid");
        for (let [aspect] of TL_ASPECTS) {
            for (let [time] of TL_TIMES) {
                let key = `${time}-${aspect}`;
                let button = tlEl("button", `tl-choice tl-${aspect}`);
                button.type = "button";
                button.dataset.key = key;
                button.append(timelineDiagram(key, "mini"), tlEl("span", "", tlTense(key).en));
                button.addEventListener("click", function () { tlAnswer(key, button); });
                grid.appendChild(button);
            }
        }
        card.appendChild(grid);
        area.appendChild(card);
    } else {
        let text = question.type === "signal" ? tlRich(question.text) : tlEl("span", "", question.text);
        card.appendChild(text).classList.add("tl-q-text");
        let list = tlEl("div", "tl-options");
        for (let option of tlShuffle(question.options)) {
            let button = tlEl("button", "tl-option");
            button.type = "button";
            button.dataset.key = option;
            if (question.type === "signal") {
                button.append(timelineDiagram(option, "mini"), tlEl("span", "", tlTense(option).en));
                button.classList.add(`tl-${tlSplit(option).aspect}`);
            } else {
                button.textContent = option;
            }
            button.addEventListener("click", function () { tlAnswer(option, button); });
            list.appendChild(button);
        }
        card.appendChild(list);
        area.appendChild(card);
    }
}

// Kısaltmaları açarak karşılaştırır: won't = will not, 've = have, n't = not
function tlNormalize(text) {
    return ieltsNorm(text)
        .replace(/\bwon't\b/g, "will not").replace(/\bcan't\b/g, "can not")
        .replace(/n't\b/g, " not").replace(/'ll\b/g, " will").replace(/'ve\b/g, " have")
        .replace(/'re\b/g, " are").replace(/'m\b/g, " am").replace(/'d\b/g, " had")
        .replace(/^(he|she|it)'s\b/, "$1 has")
        .replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
}

// place sorusunun cevabı kendi zamanıdır (ayrı answer alanı yok)
function tlAnswerOf(question) {
    return question.answer || question.tense;
}

function tlIsRight(question, value) {
    if (question.type !== "gap") {
        return value === tlAnswerOf(question);
    }
    let answers = [question.answer].concat(question.accept || []);
    let given = tlNormalize(value);
    return answers.some((answer) => tlNormalize(answer) === given);
}

function tlAnswer(value, element) {
    let session = tlSession;
    if (!session || session.answered) {
        return;
    }
    session.answered = true;
    let question = session.queue[session.index];
    let right = tlIsRight(question, value);
    let result = session.results[question.tense] || (session.results[question.tense] = { right: 0, wrong: 0, first: true, ids: [] });
    result.ids.push(question.id);
    if (right) {
        result.right++;
    } else {
        result.wrong++;
        result.first = false;
        // aynı zamanın başka bir sorusu turun sonuna eklenir (doğru yapılana kadar, en çok 5 ek soru)
        if (session.retries < 5) {
            let used = new Set(session.queue.map((item) => item.id));
            let again = tlPickQuestion(question.tense, used, tenseBoxes()) || question;
            session.queue.push(again);
            session.retries++;
        }
    }
    savedLogStudy();

    let area = document.getElementById("tlPracticeArea");
    for (let button of area.querySelectorAll(".tl-choice, .tl-option, .tl-check")) {
        button.disabled = true;
        if (button.dataset.key === tlAnswerOf(question)) {
            button.classList.add("correct");
        }
    }
    if (element) {
        element.classList.add(right ? "correct" : "wrong");
        if (element.tagName === "INPUT") {
            element.readOnly = true;
        }
    }

    let feedback = tlEl("div", `tl-feedback ${right ? "ok" : "bad"}`);
    feedback.setAttribute("role", "status");
    feedback.appendChild(tlEl("p", "tl-feedback-title", right ? "Doğru!" : "Olmadı."));
    if (!right) {
        let correct = question.type === "place" || question.type === "signal" ? tlTense(tlAnswerOf(question)).en : question.answer;
        let line = tlEl("p", "");
        line.append(tlEl("b", "", "Doğrusu: "), correct);
        feedback.appendChild(line);
    }
    feedback.appendChild(tlEl("p", "tl-why", question.why));
    // yanlışta iki zamanın şekli yan yana (görsel karşılaştırma)
    if (!right && (question.type === "place" || question.type === "signal") && tlTense(value)) {
        let sides = tlEl("div", "tl-compare-sides small");
        for (let [key, label] of [[tlAnswerOf(question), "Doğru"], [value, "Senin seçimin"]]) {
            let side = tlEl("div", `tl-compare-side tl-${tlSplit(key).aspect}`);
            side.append(tlEl("b", "", `${label}: ${tlTense(key).en}`), timelineDiagram(key, "big"), tlEl("span", "lab-note", tlTense(key).core));
            sides.appendChild(side);
        }
        feedback.appendChild(sides);
    }
    let next = tlEl("button", "tl-next", session.index + 1 < session.queue.length ? "Devam" : "Sonucu gör");
    next.type = "button";
    next.addEventListener("click", function () {
        session.index++;
        if (session.index < session.queue.length) {
            tlRenderQuestion();
        } else {
            tlFinishSession();
        }
    });
    feedback.appendChild(next);
    area.appendChild(feedback);
    next.focus();
}

function tlFinishSession() {
    let session = tlSession;
    let boxes = tenseBoxes();
    let now = Date.now();
    let freshDone = 0;
    let rows = [];
    for (let key of Object.keys(session.results)) {
        let result = session.results[key];
        let entry = boxes[key] || { box: 0, due: 0, right: 0, wrong: 0, seen: [] };
        let isNew = !boxes[key];
        // kutu yalnızca zamanı gelmiş (ya da yeni) zamanda ilerler; erken çalışmak kutuyu atlatmaz, yanlış her zaman geri atar
        let wasDue = isNew || (entry.due || 0) <= now;
        let before = entry.box;
        if (!result.first) {
            entry.box = 1;
        } else if (wasDue) {
            entry.box = Math.min(5, entry.box + 1);
        }
        if (!result.first || wasDue) {
            entry.due = now + SAVED_INTERVALS[entry.box] * SAVED_DAY;
        }
        entry.right = (entry.right || 0) + result.right;
        entry.wrong = (entry.wrong || 0) + result.wrong;
        entry.seen = (entry.seen || []).filter((id) => !result.ids.includes(id)).concat(result.ids).slice(-12);
        entry.at = now;
        boxes[key] = entry;
        if (isNew) {
            freshDone++;
        }
        rows.push({ key, result, before, after: entry.box });
    }
    tenseSaveBoxes(boxes);
    let daily = tlDaily();
    daily.fresh += freshDone;
    tlSaveDaily(daily);
    tlSession = null;

    let area = document.getElementById("tlPracticeArea");
    area.replaceChildren();
    let total = rows.reduce((sum, row) => sum + row.result.right + row.result.wrong, 0);
    let right = rows.reduce((sum, row) => sum + row.result.right, 0);
    document.getElementById("tlPracticeStatus").textContent = `Tur bitti: ${right} / ${total} doğru.`;
    let list = tlEl("ul", "tl-result");
    for (let row of TL_ORDER.map((key) => rows.find((item) => item.key === key)).filter(Boolean)) {
        let item = tlEl("li", `tl-${tlSplit(row.key).aspect}`);
        item.append(timelineDiagram(row.key, "mini"), tlEl("b", "", tlTense(row.key).en));
        let change = row.after > row.before ? `kutu ${row.before} → ${row.after}` : row.after < row.before ? `kutu ${row.before} → ${row.after} (yeniden)` : `kutu ${row.after}`;
        item.appendChild(tlEl("span", "lab-note", `${row.result.right} doğru, ${row.result.wrong} yanlış · ${change} · sıradaki ${tlDayText(boxes[row.key].due)}`));
        list.appendChild(item);
    }
    area.appendChild(list);
    let again = tlEl("button", "tl-start ghost", "Yeni tur");
    again.type = "button";
    again.addEventListener("click", tlRenderPracticeStart);
    area.appendChild(again);
    tlRenderBoard();
    tlRenderEntry();
    if (tlSelected) {
        tlSelect(tlSelected, false);
    }
}


// ----- 4. Cümle dönüştürücü -----

function tlConvert(ai) {
    let input = document.getElementById("tlSentence");
    let sentence = input.value.trim();
    let status = document.getElementById("tlConvertStatus");
    if (!sentence) {
        status.textContent = "Önce bir İngilizce cümle yaz.";
        input.focus();
        return;
    }
    let request = ++tlRequest;
    status.className = "transcript-hint";
    status.textContent = ai ? "Gemini dönüştürüyor… İlk seferde 3-10 saniye sürer, sonra hemen gelir." : "Dönüştürülüyor…";
    document.getElementById("tlConvertGo").disabled = true;
    ieltsApi("/api/tenses", { sentence, ai: Boolean(ai) })
        .then(function (data) {
            if (request === tlRequest) {
                tlRenderConverted(data);
            }
        })
        .catch(function (error) {
            if (request === tlRequest) {
                status.className = "transcript-hint error";
                status.textContent = error.message;
                tlAiOffer(sentence, false);
            }
        })
        .finally(function () { document.getElementById("tlConvertGo").disabled = false; });
}

function tlAiOffer(sentence, quiet) {
    let box = document.getElementById("tlConvertAi");
    box.replaceChildren();
    let button = tlEl("button", quiet ? "mini" : "tl-ai", quiet ? "Gemini ile de dönüştür (Türkçesi ve notlarla)" : "Gemini ile dönüştür");
    button.type = "button";
    button.addEventListener("click", function () {
        document.getElementById("tlSentence").value = sentence;
        tlConvert(true);
    });
    box.appendChild(button);
    box.hidden = false;
}

function tlRenderConverted(data) {
    let status = document.getElementById("tlConvertStatus");
    let list = document.getElementById("tlConvertRows");
    let polarity = document.getElementById("tlPolarity");
    let notes = document.getElementById("tlConvertNotes");
    let translate = document.getElementById("tlTranslate");
    list.replaceChildren();
    notes.replaceChildren();
    document.getElementById("tlConvertAi").hidden = true;
    if (!data.supported) {
        tlConverted = null;
        polarity.hidden = true;
        translate.hidden = true;
        status.className = "transcript-hint";
        status.textContent = `Kurallar bu cümleyi güvenle çeviremedi: ${data.reason}`;
        tlAiOffer(data.sentence, false);
        return;
    }
    tlConverted = data;
    let gemini = data.source === "gemini";
    polarity.hidden = gemini;
    translate.hidden = gemini;
    // Tablo yazılan cümlenin biçimiyle açılır (olumsuz cümle → Olumsuz)
    tlPolarity = !gemini && data.negative ? "neg" : "pos";
    for (let button of polarity.querySelectorAll("button")) {
        button.setAttribute("aria-pressed", String(button.dataset.polarity === tlPolarity));
    }
    let detected = tlTense(data.detected);
    status.className = "transcript-hint";
    status.textContent = gemini
        ? `Gemini (${data.model || "yapay zekâ"}) dönüştürdü${detected ? `; senin cümlen: ${detected.en}` : ""}. Yapay zekâ üretimidir, hata içerebilir.`
        : `Senin cümlen: ${detected ? detected.en : "?"}${data.negative ? " (olumsuz)" : ""}. Kurallarla anında kuruldu; renkli parçalar zamanın işaretleridir.`;
    for (let note of data.notes || []) {
        notes.appendChild(tlEl("li", "", note));
    }
    if (!gemini) {
        tlAiOffer(data.sentence, true);
    }
    tlRenderConvertedRows();
}

function tlRenderConvertedRows() {
    let list = document.getElementById("tlConvertRows");
    list.replaceChildren();
    if (!tlConverted) {
        return;
    }
    for (let [time, label] of TL_TIMES) {
        let group = tlEl("li", "tl-conv-group");
        group.appendChild(tlEl("span", "tl-conv-time", label));
        let rows = tlEl("ul", "tl-conv-rows");
        for (let [aspect] of TL_ASPECTS) {
            let key = `${time}-${aspect}`;
            let row = tlConverted.rows.find((item) => item.key === key);
            if (!row) {
                continue;
            }
            let form = row[tlPolarity] || row.pos;
            let item = tlEl("li", `tl-conv tl-${aspect}${key === tlConverted.detected ? " mine" : ""}`);
            let name = tlEl("button", "tl-conv-name");
            name.type = "button";
            name.append(timelineDiagram(key, "mini"), tlEl("span", "", tlTense(key).en));
            name.title = "Bu zamanın ayrıntısını aç";
            name.addEventListener("click", function () { tlSelect(key, true); });
            item.appendChild(name);
            let body = tlEl("div", "tl-conv-body");
            let sentence = tlEl("p", "tl-conv-text");
            for (let word of tlWords(form.parts)) {
                let span = tlEl("span", "tl-word");
                for (let part of word) {
                    span.appendChild(part.r ? tlEl("span", `tl-r-${part.r}`, part.t) : document.createTextNode(part.t));
                }
                sentence.append(span, " ");
            }
            body.appendChild(sentence);
            if (key === tlConverted.detected) {
                body.appendChild(tlEl("span", "chip tl-mine", "senin cümlen"));
            }
            if (row.natural === false) {
                body.appendChild(tlEl("span", "chip tl-unnatural", "doğal değil"));
            }
            if (row.note) {
                body.appendChild(tlEl("p", "tl-conv-note", row.note));
            }
            let tr = row.tr || tlTranslations[form.text];
            if (tr) {
                body.appendChild(tlEl("p", "gr-tr", tr));
            }
            item.appendChild(body);
            rows.appendChild(item);
        }
        group.appendChild(rows);
        list.appendChild(group);
    }
}

// Bitişik parçaları kelime olarak gruplar (fiil gövdesi + ek, kelime + noktalama)
function tlWords(parts) {
    let words = [];
    for (let part of parts) {
        let last = words[words.length - 1];
        if (last && (part.r === "p" || (last[last.length - 1].r === "verb" && part.r === "suf"))) {
            last.push(part);
        } else {
            words.push([part]);
        }
    }
    return words;
}

function tlTranslateAll() {
    if (!tlConverted || tlConverted.source !== "rules") {
        return;
    }
    let button = document.getElementById("tlTranslate");
    let status = document.getElementById("tlConvertStatus");
    let texts = tlConverted.rows.map((row) => (row[tlPolarity] || row.pos).text).filter((text) => !tlTranslations[text]);
    button.disabled = true;
    let failed = false;
    // ikişerli: çeviri servisini zorlamamak için
    let queue = texts.slice();
    let worker = function () {
        let text = queue.shift();
        if (!text) {
            return Promise.resolve();
        }
        return ieltsApi(`/api/translate?text=${encodeURIComponent(text)}`)
            .then(function (data) { tlTranslations[text] = data.tr; })
            .catch(function (error) {
                failed = true;
                queue.length = 0;
                status.textContent = error.message;
            })
            .then(worker);
    };
    Promise.all([worker(), worker()]).then(function () {
        button.disabled = false;
        if (!failed) {
            tlRenderConvertedRows();
        }
    });
}


// ----- 5. Görünüm ve giriş kartı -----

function tlRenderEntry() {
    let entry = document.getElementById("tlEntry");
    if (!entry) {
        return;
    }
    if (!langHas("tenses")) {
        entry.hidden = true;
        return;
    }
    let summary = tenseDueSummary(Date.now());
    let text = summary.started === 0
        ? "Henüz başlamadın: ilk turda 3 zamanla başla."
        : summary.due > 0 ? `${summary.due} zamanın tekrarı geldi.` : `${summary.started} / ${TENSE_COUNT} zaman çalışılıyor; bugünlük tekrar yok.`;
    show("tlEntryDue", text);
    entry.hidden = false;
}

function timelineHide() {
    let view = document.getElementById("grTimeline");
    if (view) {
        view.hidden = true;
    }
    tlRenderEntry();
}

function timelineOpen() {
    if (!langHas("tenses")) {
        return false;
    }
    document.getElementById("grBrowse").hidden = true;
    document.getElementById("grLesson").hidden = true;
    document.getElementById("grTimeline").hidden = false;
    window.scrollTo({ top: 0 });
    let ready = tlData ? Promise.resolve() : fetch("data/zamanlar.json")
        .then(function (response) { return response.json(); })
        .then(function (data) { tlData = data; });
    ready.then(function () {
        tlRenderBoard();
        if (!tlSession) {
            tlRenderPracticeStart();
        }
        tlSelect(tlSelected || "present-perfect", false);
    }).catch(function () {
        document.getElementById("tlBoard").replaceChildren(tlEl("p", "error", "Zaman çizgisi yüklenemedi. Sunucu çalışıyor mu? (python server.py)"));
    });
    return true;
}

if (document.getElementById("grTimeline")) {
    document.getElementById("tlBack").addEventListener("click", function () {
        history.pushState(null, "", location.pathname);
        gramerShowBrowse();
    });
    document.getElementById("tlConvertForm").addEventListener("submit", function (event) {
        event.preventDefault();
        tlConvert(false);
    });
    for (let button of document.querySelectorAll("#tlPolarity button")) {
        button.addEventListener("click", function () {
            tlPolarity = button.dataset.polarity;
            for (let other of document.querySelectorAll("#tlPolarity button")) {
                other.setAttribute("aria-pressed", other === button ? "true" : "false");
            }
            tlRenderConvertedRows();
        });
    }
    document.getElementById("tlTranslate").addEventListener("click", tlTranslateAll);
    let samples = document.getElementById("tlSamples");
    for (let text of TL_EXAMPLES) {
        let chip = tlEl("button", "mini", text);
        chip.type = "button";
        chip.addEventListener("click", function () {
            document.getElementById("tlSentence").value = text;
            tlConvert(false);
        });
        samples.appendChild(chip);
    }
    tlRenderEntry();
}
