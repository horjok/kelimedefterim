// ===== IELTS sayfası: sekmeler, sınav türü, genel bakış, taktikler, bant hesaplayıcı, yol haritası =====
// Sabit içerik ielts-data.js içinde; ieltsElement ve soru bileşeni quiz.js içinde. Çalışma alanları (Reading, Listening, Writing, Speaking) ielts-practice.js içinde.
// localStorage: "ielts:profile" { module, current, target, date, minutes, weak, madeAt },
//               "ielts:roadmap" { işaretlenen görev id'si: true }, "ielts:results" [ { kind, title, score, total, at } ].

const IELTS_TABS = ["genel", "taktik", "yol", "gramer", "reading", "listening", "writing", "speaking"];
const IELTS_DAY = 24 * 60 * 60 * 1000;

function ieltsRead(key, fallback) {
    try {
        let value = JSON.parse(localStorage.getItem(key));
        return value === null || typeof value !== typeof fallback ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function ieltsWrite(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        return false;  // depolama kapalı ya da dolu
    }
}

let ieltsProfile = ieltsRead("ielts:profile", {});
let ieltsModule = ieltsProfile.module === "general" ? "general" : "academic";


// ----- Sekmeler ve sınav türü -----

function ieltsShowTab(name) {
    if (!IELTS_TABS.includes(name)) {
        name = "genel";
    }
    for (let button of document.querySelectorAll("#ieltsTabs button")) {
        button.setAttribute("aria-selected", button.dataset.tab === name ? "true" : "false");
    }
    for (let panel of document.querySelectorAll(".ielts-panel")) {
        panel.hidden = panel.dataset.panel !== name;
    }
    if (location.hash !== `#${name}`) {
        history.replaceState(null, "", `#${name}`);
    }
    if (name === "yol") {
        ieltsRenderResults();
    }
    if (typeof ieltsPracticeOpen === "function") {
        ieltsPracticeOpen(name);  // çalışma sekmeleri ilk açılışta listelerini yükler
    }
}

function ieltsSetModule(name) {
    ieltsModule = name === "general" ? "general" : "academic";
    for (let button of document.querySelectorAll("#ieltsModule button")) {
        button.setAttribute("aria-pressed", button.dataset.module === ieltsModule ? "true" : "false");
    }
    ieltsProfile.module = ieltsModule;
    ieltsWrite("ielts:profile", ieltsProfile);
    ieltsRenderSections();
    ieltsRenderTactics();
    if (typeof ieltsPracticeModuleChanged === "function") {
        ieltsPracticeModuleChanged();
    }
}


// ----- Genel bakış -----

function ieltsRenderSections() {
    let box = document.getElementById("ieltsSections");
    box.replaceChildren();
    for (let section of IELTS_SECTIONS) {
        let card = ieltsElement("article", "panel ielts-section");
        let head = ieltsElement("div", "ielts-section-head");
        head.append(ieltsElement("h3", "", section.name), ieltsElement("span", "chip", section.time), ieltsElement("span", "chip", section.count));
        card.appendChild(head);
        let list = ieltsElement("ul", "ielts-list");
        for (let line of [...(section[ieltsModule] || []), ...section.both]) {
            list.appendChild(ieltsElement("li", "", line));
        }
        card.appendChild(list);
        let link = ieltsElement("button", "mini", `${section.name} çalış`);
        link.type = "button";
        link.addEventListener("click", function () { ieltsShowTab(section.key); });
        card.appendChild(link);
        box.appendChild(card);
    }
}

function ieltsRenderCriteria() {
    for (let [skill, id] of [["writing", "ieltsCriteriaWriting"], ["speaking", "ieltsCriteriaSpeaking"]]) {
        let list = document.getElementById(id);
        list.replaceChildren();
        for (let item of IELTS_CRITERIA[skill]) {
            let row = ieltsElement("li");
            row.append(ieltsElement("b", "", item.name), ` (${item.tr}): ${item.hint}`);
            list.appendChild(row);
        }
    }
}


// ----- Bant hesaplayıcı -----

function ieltsBandOptions(select, from, to, chosen) {
    select.replaceChildren();
    for (let band = from; band <= to; band += 0.5) {
        let option = ieltsElement("option", "", band.toFixed(1));
        option.value = String(band);
        option.selected = band === chosen;
        select.appendChild(option);
    }
}

// Resmi kural: ortalama en yakın yarım banda yuvarlanır; .25 yarıma, .75 tam banda çıkar
function ieltsOverall(bands) {
    let average = bands.reduce((sum, band) => sum + band, 0) / bands.length;
    return { average: average, overall: Math.floor(average * 2 + 0.5) / 2 };
}

function ieltsCalcUpdate() {
    let bands = [...document.querySelectorAll("#ieltsCalc select")].map((select) => Number(select.value));
    let result = ieltsOverall(bands);
    document.getElementById("ieltsOverall").textContent = result.overall.toFixed(1);
    document.getElementById("ieltsAverage").textContent = `ortalama ${result.average.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}


// ----- Taktikler -----

function ieltsRenderTactics() {
    let box = document.getElementById("ieltsTactics");
    box.replaceChildren();
    for (let group of IELTS_TACTICS) {
        let panel = ieltsElement("article", "panel");
        panel.appendChild(ieltsElement("h3", "", group.name));
        let grid = ieltsElement("div", "ielts-tactics");
        for (let item of group.items) {
            if (item.module && item.module !== ieltsModule) {
                continue;
            }
            let card = ieltsElement("div", "ielts-tactic");
            card.appendChild(ieltsElement("h4", "", item.title));
            card.appendChild(ieltsElement("p", "", item.text));
            if (item.link) {
                let link = ieltsElement("a", "mini", `${item.linkText} →`);
                link.href = item.link;
                card.appendChild(link);
            }
            grid.appendChild(card);
        }
        panel.appendChild(grid);
        box.appendChild(panel);
    }
}


// ----- Yol haritası -----

function ieltsDateText(date) {
    return date.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
}

// Haftalık tekrar sayısı: günlük süreye göre. scale: "skill" ana beceri, "writing" yazı, "light" hafif
function ieltsRepeat(scale, minutes) {
    let level = minutes >= 120 ? 2 : minutes >= 60 ? 1 : 0;
    return { skill: [1, 2, 3], writing: [1, 1, 2], light: [1, 1, 2] }[scale][level];
}

// Haftaları evrelere böler: yaklaşık %30 Temel, %50 Beceri, %20 Deneme (en az 1 hafta Deneme, mümkünse)
function ieltsPhasePlan(weeks) {
    if (weeks <= 1) return ["beceri"];
    if (weeks === 2) return ["beceri", "deneme"];
    let trial = Math.max(1, Math.round(weeks * 0.2));
    let base = Math.max(1, Math.round(weeks * 0.3));
    let plan = [];
    for (let week = 0; week < weeks; week++) {
        plan.push(week < base ? "temel" : week >= weeks - trial ? "deneme" : "beceri");
    }
    return plan;
}

function ieltsBuildRoadmap(profile) {
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    let exam = new Date(profile.date + "T00:00:00");
    let days = Math.round((exam - today) / IELTS_DAY);
    let weeks = Math.min(26, Math.max(1, Math.ceil(days / 7)));
    let phases = ieltsPhasePlan(weeks);
    let seenOnce = new Set();
    let list = [];
    phases.forEach(function (phaseKey, index) {
        let phase = IELTS_PHASES.find((item) => item.key === phaseKey);
        let tasks = [];
        for (let task of phase.tasks) {
            if (task.once) {
                if (seenOnce.has(`${phaseKey}:${task.key}`)) {
                    continue;
                }
                seenOnce.add(`${phaseKey}:${task.key}`);
            }
            let text = task.scale ? task.text.replace("{n}", ieltsRepeat(task.scale, profile.minutes)) : task.text;
            tasks.push({ id: `w${index + 1}-${phaseKey}-${task.key}`, text: text, link: task.link });
        }
        if (profile.weak && IELTS_WEAK_TASKS[profile.weak]) {
            tasks.push({ id: `w${index + 1}-weak`, text: IELTS_WEAK_TASKS[profile.weak].text, link: IELTS_WEAK_TASKS[profile.weak].link });
        }
        let start = new Date(today.getTime() + index * 7 * IELTS_DAY);
        let end = new Date(Math.min(start.getTime() + 6 * IELTS_DAY, exam.getTime() - IELTS_DAY));
        list.push({ number: index + 1, phase: phase, start: start, end: end, tasks: tasks });
    });
    return { days: days, weeks: weeks, shown: list, hours: Math.round(days * profile.minutes / 60) };
}

// Hedef ile süre arasındaki denge hakkında dürüst bir not (kesin kural yok; bu bir uyarı, tahmin değil)
function ieltsRealityNote(profile, plan) {
    let gap = profile.target - profile.current;
    if (gap <= 0) {
        return "Hedefin şu anki bandınla aynı ya da daha düşük: plan seviyeni korumaya ve sınav biçimine alışmaya yönelik.";
    }
    let weeksPerHalfBand = plan.weeks / (gap * 2);
    if (weeksPerHalfBand < 2 || (gap >= 1.5 && plan.weeks < 10)) {
        return `Dikkat: ${plan.weeks} haftada ${gap.toFixed(1)} bant yükselmek iddialı bir hedef. Bant artışı için kesin bir süre yoktur, ama çoğu aday için yarım bant bile haftalarca düzenli çalışma ister. Sınav tarihini ertelemeyi ya da günlük süreyi artırmayı düşün; plan yine de en verimli sırayı izler.`;
    }
    return `${plan.weeks} haftada ${gap.toFixed(1)} bant için düzenli çalışırsan makul bir hedef. Bant artışının garantisi yoktur; her iki haftada bir Reading ve Writing sonuçlarına bakıp planı güncelle.`;
}

function ieltsRenderRoadmap() {
    let summary = document.getElementById("roadmapSummary");
    let weeksBox = document.getElementById("roadmapWeeks");
    summary.replaceChildren();
    weeksBox.replaceChildren();
    let profile = ieltsProfile;
    if (!profile.date || !profile.target) {
        return;
    }
    let plan = ieltsBuildRoadmap(profile);
    let checked = ieltsRead("ielts:roadmap", {});

    let tiles = ieltsElement("div", "tiles");
    let done = plan.shown.reduce((sum, week) => sum + week.tasks.filter((task) => checked[task.id]).length, 0);
    let total = plan.shown.reduce((sum, week) => sum + week.tasks.length, 0);
    for (let [label, value, sub] of [
        ["Hedef", profile.target.toFixed(1), `şu an ${profile.current.toFixed(1)}`],
        ["Sınava kalan", plan.days > 0 ? `${plan.days} gün` : "geçti", plan.days > 0 ? `${plan.weeks} hafta` : "yeni tarih gir"],
        ["Toplam çalışma", `${plan.hours} saat`, `günde ${profile.minutes} dk`],
        ["Tamamlanan", `${done} / ${total}`, "görev"]
    ]) {
        let tile = ieltsElement("div", "tile");
        tile.append(ieltsElement("span", "tile-label", label), ieltsElement("span", "tile-value", value), ieltsElement("span", "tile-sub", sub));
        tiles.appendChild(tile);
    }
    summary.appendChild(tiles);
    if (plan.days <= 0) {
        summary.appendChild(ieltsElement("p", "error", "Sınav tarihi geçmiş ya da bugün. Yukarıdan yeni bir tarih gir."));
        return;
    }
    summary.appendChild(ieltsElement("p", "ielts-note", ieltsRealityNote(profile, plan)));

    let today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let week of plan.shown) {
        let current = today >= week.start && today <= week.end;
        let card = ieltsElement("details", "panel ielts-week");
        card.open = current;
        let head = ieltsElement("summary");
        let weekDone = week.tasks.filter((task) => checked[task.id]).length;
        head.append(
            ieltsElement("span", "ielts-week-title", `${week.number}. hafta`),
            ieltsElement("span", `chip ielts-phase-${week.phase.key}`, week.phase.name),
            ieltsElement("span", "saved-video-count", `${ieltsDateText(week.start)} – ${ieltsDateText(week.end)} · ${weekDone}/${week.tasks.length}`)
        );
        card.appendChild(head);
        card.appendChild(ieltsElement("p", "lab-note", week.phase.goal));
        let list = ieltsElement("ul", "ielts-list ielts-checks");
        for (let task of week.tasks) {
            let row = ieltsElement("li");
            let label = ieltsElement("label", "check");
            let box = ieltsElement("input");
            box.type = "checkbox";
            box.checked = Boolean(checked[task.id]);
            box.addEventListener("change", function () {
                let state = ieltsRead("ielts:roadmap", {});
                if (box.checked) {
                    state[task.id] = true;
                } else {
                    delete state[task.id];
                }
                ieltsWrite("ielts:roadmap", state);
                ieltsRenderRoadmap();
            });
            label.append(box, ieltsElement("span", "", task.text));
            row.appendChild(label);
            if (task.link) {
                let link = ieltsElement("a", "mini", "Aç →");
                link.href = task.link;
                if (task.link.startsWith("ielts.html#")) {
                    link.addEventListener("click", function (event) {
                        event.preventDefault();
                        ieltsShowTab(task.link.split("#")[1]);
                        window.scrollTo({ top: 0 });
                    });
                }
                row.appendChild(link);
            }
            list.appendChild(row);
        }
        card.appendChild(list);
        weeksBox.appendChild(card);
    }
}

function ieltsRoadmapSubmit(event) {
    event.preventDefault();
    let message = document.getElementById("roadmapMessage");
    let date = document.getElementById("roadmapDate").value;
    message.className = "error";
    if (!date) {
        message.textContent = "Sınav tarihini seç.";
        return;
    }
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(date + "T00:00:00") <= today) {
        message.textContent = "Sınav tarihi bugünden sonra olmalı.";
        return;
    }
    let previous = ieltsProfile.date;
    ieltsProfile = {
        ...ieltsProfile,
        current: Number(document.getElementById("roadmapCurrent").value),
        target: Number(document.getElementById("roadmapTarget").value),
        date: date,
        minutes: Number(document.getElementById("roadmapMinutes").value),
        weak: document.getElementById("roadmapWeak").value,
        madeAt: Date.now()
    };
    if (previous && previous !== date) {
        ieltsWrite("ielts:roadmap", {});  // tarih değişince haftalar kayar: eski işaretler anlamsızlaşır
    }
    if (!ieltsWrite("ielts:profile", ieltsProfile)) {
        message.textContent = "Kaydedilemedi: tarayıcı depolaması kapalı ya da dolu.";
        return;
    }
    message.className = "ok";
    message.textContent = "Yol haritan hazır. Görevleri bitirdikçe işaretle.";
    ieltsRenderRoadmap();
}

function ieltsFillRoadmapForm() {
    ieltsBandOptions(document.getElementById("roadmapCurrent"), 3, 8.5, ieltsProfile.current || 5.5);
    ieltsBandOptions(document.getElementById("roadmapTarget"), 4, 9, ieltsProfile.target || 6.5);
    if (ieltsProfile.date) {
        document.getElementById("roadmapDate").value = ieltsProfile.date;
    }
    if (ieltsProfile.minutes) {
        document.getElementById("roadmapMinutes").value = String(ieltsProfile.minutes);
    }
    document.getElementById("roadmapWeak").value = ieltsProfile.weak || "";
    let tomorrow = new Date(Date.now() + IELTS_DAY);
    document.getElementById("roadmapDate").min = tomorrow.toISOString().slice(0, 10);
}


// ----- Çalışma geçmişi (ielts-practice.js yazar) -----

function ieltsAddResult(result) {
    let list = ieltsRead("ielts:results", []);
    list.unshift({ ...result, at: Date.now() });
    ieltsWrite("ielts:results", list.slice(0, 40));
}

function ieltsRenderResults() {
    let box = document.getElementById("ieltsResults");
    let list = ieltsRead("ielts:results", []);
    box.replaceChildren();
    if (list.length === 0) {
        box.appendChild(ieltsElement("p", "saved-empty", "Henüz çalışma yok. Reading, Listening ya da Writing sekmesinde bir set bitirince burada görünür."));
        return;
    }
    for (let item of list.slice(0, 12)) {
        let row = ieltsElement("div", "today-video");
        let names = { reading: "Reading", listening: "Listening", writing: "Writing", grammar: "Gramer" };
        row.appendChild(ieltsElement("span", "today-video-title", `${names[item.kind] || item.kind} · ${item.title || ""}`));
        let score = item.kind === "writing" ? `tahmini bant ${Number(item.score).toFixed(1)}` : `${item.score} / ${item.total}`;
        row.appendChild(ieltsElement("span", "saved-video-count", `${score} · ${ieltsDateText(new Date(item.at))}`));
        box.appendChild(row);
    }
}


// ----- Başlangıç -----

for (let button of document.querySelectorAll("#ieltsTabs button")) {
    button.addEventListener("click", function () { ieltsShowTab(button.dataset.tab); });
}
for (let button of document.querySelectorAll("#ieltsModule button")) {
    button.addEventListener("click", function () { ieltsSetModule(button.dataset.module); });
}
for (let select of document.querySelectorAll("#ieltsCalc select")) {
    ieltsBandOptions(select, 0, 9, 6);
    select.addEventListener("change", ieltsCalcUpdate);
}
document.getElementById("roadmapForm").addEventListener("submit", ieltsRoadmapSubmit);
window.addEventListener("hashchange", function () { ieltsShowTab(location.hash.slice(1)); });

ieltsRenderCriteria();
ieltsCalcUpdate();
ieltsFillRoadmapForm();
ieltsSetModule(ieltsModule);
ieltsRenderRoadmap();
// Sekme, ielts-practice.js yüklendikten sonra açılır (o dosyanın sonunda): ieltsShowTab(location.hash.slice(1))
