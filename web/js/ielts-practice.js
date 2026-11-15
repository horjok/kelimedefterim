// ===== IELTS sayfası: çalışma alanları (Reading, Listening, Writing, Speaking) =====
// Sorular ve Writing değerlendirmesi sunucudan gelir (backend/ielts.py, Gemini). Ortak parçalar quiz.js içinde
// (ieltsElement, ieltsApi, ieltsNorm, ieltsRenderQuestions). Yardımcılar ielts.js içinde:
// ieltsElement, ieltsRead, ieltsWrite, ieltsAddResult, ieltsModule, IELTS_CRITERIA.
// Gemini her istekte "IELTS eğitmeni" personasıyla yanıt verir (ielts.py TUTOR_PERSONA).
// Zorluk: her beceri için ayrı seviye (bant 5-8), isteklerle birlikte "level" olarak gider.
// localStorage: "ielts:writing:draft" { task, module, data, text }, "ielts:levels" { reading, listening, writing, speaking }.

// ----- Zorluk seviyeleri -----

const IELTS_LEVELS = [
    { value: 5, label: "Bant 5 · temel" },
    { value: 6, label: "Bant 6 · orta" },
    { value: 7, label: "Bant 7 · ileri" },
    { value: 8, label: "Bant 8+ · çok ileri" }
];
let ieltsLevels = ieltsRead("ielts:levels", {});

// Seçilmemişse yol haritasındaki hedef banda göre başlar (yoksa 6)
function ieltsDefaultLevel() {
    let target = Math.floor(Number(ieltsProfile.target) || 6);
    return Math.min(8, Math.max(5, target));
}

function ieltsLevel(skill) {
    let level = Number(ieltsLevels[skill]);
    return IELTS_LEVELS.some((item) => item.value === level) ? level : ieltsDefaultLevel();
}

function ieltsFillLevels() {
    for (let select of document.querySelectorAll("select.ielts-level")) {
        select.replaceChildren();
        for (let item of IELTS_LEVELS) {
            let option = ieltsElement("option", "", item.label);
            option.value = String(item.value);
            select.appendChild(option);
        }
        select.value = String(ieltsLevel(select.dataset.skill));
        select.addEventListener("change", function () {
            ieltsLevels[select.dataset.skill] = Number(select.value);
            ieltsWrite("ielts:levels", ieltsLevels);
        });
    }
}

function ieltsStatus(id, text, className) {
    let status = document.getElementById(id);
    status.textContent = text;
    status.className = className ? `transcript-hint ${className}` : "transcript-hint";
}

function ieltsClock(seconds) {
    let total = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Geri sayım: { start(), stop(), reset(saniye), running }
function ieltsTimer(element, seconds, onEnd) {
    let timer = { running: false, left: seconds, handle: 0, endAt: 0 };
    function paint() {
        element.textContent = ieltsClock(timer.left);
        element.classList.toggle("ending", timer.left <= 60 && timer.left > 0);
        element.classList.toggle("ended", timer.left <= 0);
    }
    timer.stop = function () {
        clearInterval(timer.handle);
        timer.running = false;
    };
    timer.start = function () {
        if (timer.running || timer.left <= 0) {
            return;
        }
        timer.running = true;
        timer.endAt = Date.now() + timer.left * 1000;
        timer.handle = setInterval(function () {
            timer.left = (timer.endAt - Date.now()) / 1000;  // sekme arka plandayken de doğru kalsın
            paint();
            if (timer.left <= 0) {
                timer.stop();
                if (onEnd) {
                    onEnd();
                }
            }
        }, 250);
    };
    timer.reset = function (value) {
        timer.stop();
        timer.left = value;
        paint();
    };
    paint();
    return timer;
}


function ieltsFillSets(selectId, kind) {
    return ieltsApi(`/api/ielts/sets?kind=${kind}`).then(function (data) {
        let select = document.getElementById(selectId);
        select.replaceChildren(ieltsElement("option", "", data.sets.length ? "Seç…" : "Henüz yok"));
        select.firstChild.value = "";
        for (let item of data.sets) {
            let date = new Date(item.created * 1000).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
            let level = item.level ? `bant ${item.level}, ` : "";
            let option = ieltsElement("option", "", `${item.title.slice(0, 50)} (${level}${item.count} soru, ${date})`);
            option.value = item.id;
            select.appendChild(option);
        }
    }).catch(function () { /* liste gelmezse seçim boş kalır */ });
}


// ===== Reading =====

const READING_SECONDS = 20 * 60;
let readingSet = null;
let readingQuiz = null;
let readingTimer = ieltsTimer(document.getElementById("readingTimer"), READING_SECONDS, function () {
    ieltsStatus("readingStatus", "Süre doldu. Sınavda burada bırakman gerekirdi; istersen bitirip kontrol et.", "error");
});

function readingShow(set) {
    readingSet = set;
    document.getElementById("readingBody").hidden = false;
    document.getElementById("readingScore").textContent = "";
    document.getElementById("readingCheck").disabled = false;
    let passage = document.getElementById("readingPassage");
    passage.replaceChildren(ieltsElement("h3", "", set.title));
    set.paragraphs.forEach(function (text, index) {
        let paragraph = ieltsElement("p", "ielts-paragraph");
        paragraph.id = `readingParagraph${index + 1}`;
        paragraph.append(ieltsElement("b", "ielts-letter", IELTS_LETTERS[index] || String(index + 1)), text);
        passage.appendChild(paragraph);
    });
    readingQuiz = ieltsRenderQuestions(document.getElementById("readingQuestions"), set.questions, function (question) {
        if (!question.paragraph) {
            return null;
        }
        let button = ieltsElement("button", "mini", `Kanıt: ${IELTS_LETTERS[question.paragraph - 1]} paragrafı`);
        button.type = "button";
        button.addEventListener("click", function () {
            let target = document.getElementById(`readingParagraph${question.paragraph}`);
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.add("flash");
            setTimeout(function () { target.classList.remove("flash"); }, 1800);
        });
        return button;
    });
    document.getElementById("readingTimer").hidden = false;
    readingTimer.reset(READING_SECONDS);
    readingTimer.start();
    let words = set.paragraphs.join(" ").split(/\s+/).length;
    let level = set.level ? `Bant ${set.level} seviyesi · ` : "";
    ieltsStatus("readingStatus", `${level}${words} kelimelik metin, ${set.questions.length} soru. Süre başladı.`);
}

function readingNew() {
    let button = document.getElementById("readingNew");
    button.disabled = true;
    ieltsStatus("readingStatus", "Metin ve sorular üretiliyor… Genelde 5-15 saniye.");
    ieltsApi("/api/ielts/reading", { module: ieltsModule, level: ieltsLevel("reading") })
        .then(function (set) {
            readingShow(set);
            ieltsFillSets("readingOld", "reading");
        })
        .catch(function (error) { ieltsStatus("readingStatus", error.message, "error"); })
        .finally(function () { button.disabled = false; });
}

document.getElementById("readingNew").addEventListener("click", readingNew);
document.getElementById("readingOld").addEventListener("change", function (event) {
    if (!event.target.value) {
        return;
    }
    ieltsApi(`/api/ielts/set?kind=reading&id=${encodeURIComponent(event.target.value)}`)
        .then(readingShow)
        .catch(function (error) { ieltsStatus("readingStatus", error.message, "error"); });
});
document.getElementById("readingCheck").addEventListener("click", function () {
    if (!readingQuiz) {
        return;
    }
    readingTimer.stop();
    let result = readingQuiz.check();
    document.getElementById("readingCheck").disabled = true;
    document.getElementById("readingScore").textContent = `${result.score} / ${result.total} doğru`;
    ieltsAddResult({ kind: "reading", title: readingSet.title, score: result.score, total: result.total });
});


// ===== Listening =====

let listeningSet = null;
let listeningQuiz = null;
let listeningPlayer = null;
let ieltsYouTubeResolve;
let ieltsYouTubeReady = new Promise(function (resolve) { ieltsYouTubeResolve = resolve; });
function onYouTubeIframeAPIReady() {  // iframe_api yüklenince bu adı çağırır
    ieltsYouTubeResolve();
}

function listeningShow(set) {
    listeningSet = set;
    document.getElementById("listeningBody").hidden = false;
    document.getElementById("listeningScore").textContent = "";
    document.getElementById("listeningCheck").disabled = false;
    document.getElementById("listeningCover").textContent = set.covered < set.total
        ? `Sorular videonun baştaki bölümünden (ilk ${set.covered} cümle): ${set.title}`
        : set.title;
    ieltsYouTubeReady.then(function () {
        if (listeningPlayer && typeof listeningPlayer.cueVideoById === "function") {
            listeningPlayer.cueVideoById(set.videoId);
        } else {
            listeningPlayer = new YT.Player("listeningPlayer", { videoId: set.videoId, playerVars: { rel: 0, playsinline: 1 } });
        }
    });
    listeningQuiz = ieltsRenderQuestions(document.getElementById("listeningQuestions"), set.questions, function (question) {
        let box = ieltsElement("p", "ielts-heard");
        let link = ieltsElement("a", "mini", "▶ Videoda dinle");
        link.href = `video.html?v=${encodeURIComponent(set.videoId)}&t=${Math.floor(question.start)}`;
        link.target = "_blank";
        link.rel = "noopener";
        box.append("Duyulan: ", ieltsElement("i", "", question.heard), " ", link);
        return box;
    });
    let level = set.level ? `Bant ${set.level} seviyesi · ` : "";
    ieltsStatus("listeningStatus", `${level}${set.questions.length} soru hazır. Videoyu başlat ve dinlerken cevapla.`);
}

function listeningNew() {
    let video = document.getElementById("listeningVideo").value;
    if (!video) {
        ieltsStatus("listeningStatus", "Önce bir video seç. Liste boşsa Video sayfasında bir video aç.", "error");
        return;
    }
    let button = document.getElementById("listeningNew");
    button.disabled = true;
    ieltsStatus("listeningStatus", "Sorular üretiliyor… Genelde 5-15 saniye.");
    ieltsApi("/api/ielts/listening", { url: video, level: ieltsLevel("listening") })
        .then(function (set) {
            listeningShow(set);
            ieltsFillSets("listeningOld", "listening");
        })
        .catch(function (error) { ieltsStatus("listeningStatus", error.message, "error"); })
        .finally(function () { button.disabled = false; });
}

function listeningFillVideos() {
    return ieltsApi("/api/ielts/videos").then(function (data) {
        let select = document.getElementById("listeningVideo");
        select.replaceChildren(ieltsElement("option", "", data.videos.length ? "Seç…" : "Henüz video yok"));
        select.firstChild.value = "";
        for (let video of data.videos) {
            let option = ieltsElement("option", "", `${(video.title || video.videoId).slice(0, 60)} (${video.lines} cümle)`);
            option.value = video.videoId;
            select.appendChild(option);
        }
    }).catch(function () { /* liste gelmezse seçim boş kalır */ });
}

document.getElementById("listeningNew").addEventListener("click", listeningNew);
document.getElementById("listeningOld").addEventListener("change", function (event) {
    if (!event.target.value) {
        return;
    }
    ieltsApi(`/api/ielts/set?kind=listening&id=${encodeURIComponent(event.target.value)}`)
        .then(listeningShow)
        .catch(function (error) { ieltsStatus("listeningStatus", error.message, "error"); });
});
document.getElementById("listeningCheck").addEventListener("click", function () {
    if (!listeningQuiz) {
        return;
    }
    let result = listeningQuiz.check();
    document.getElementById("listeningCheck").disabled = true;
    document.getElementById("listeningScore").textContent = `${result.score} / ${result.total} doğru`;
    ieltsAddResult({ kind: "listening", title: listeningSet.title, score: result.score, total: result.total });
});


// ===== Writing =====

const WRITING_COLORS = ["#4F46E5", "#16A34A", "#D97706", "#DB2777"];
let writingTask = 2;
let writingData = null;  // sunucudan gelen konu
let writingTimer = ieltsTimer(document.getElementById("writingTimer"), 40 * 60, function () {
    document.getElementById("writingTimerToggle").textContent = "Süreyi sıfırla";
    ieltsStatus("writingStatus", "Süre doldu. Sınavda burada bırakman gerekirdi.", "error");
});

function writingMinimum() {
    return writingTask === 1 ? 150 : 250;
}

function writingSvg(tag, attributes, text) {
    let element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (let name in attributes) {
        element.setAttribute(name, attributes[name]);
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

// Academic Task 1 grafiği: gruplu çubuk ya da çizgi (basit SVG) + altında veri tablosu
function writingChart(chart) {
    let box = ieltsElement("figure", "ielts-chart");
    box.appendChild(ieltsElement("figcaption", "", chart.unit ? `${chart.title} (${chart.unit})` : chart.title));
    let width = 560, height = 260, left = 44, right = 12, top = 12, bottom = 34;
    let plotW = width - left - right, plotH = height - top - bottom;
    let max = Math.max(1, ...chart.series.flatMap((series) => series.values));
    let step = Math.pow(10, Math.floor(Math.log10(max)));
    let ticks = Math.ceil(max / step) <= 3 ? step / 2 : step;
    let ceiling = Math.ceil(max / ticks) * ticks;
    let svg = writingSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": chart.title });
    for (let value = 0; value <= ceiling + 1e-9; value += ticks) {
        let y = top + plotH - (value / ceiling) * plotH;
        svg.appendChild(writingSvg("line", { x1: left, x2: width - right, y1: y, y2: y, stroke: "#C7D2FE", "stroke-width": 1 }));
        svg.appendChild(writingSvg("text", { x: left - 6, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "#475569" }, String(Math.round(value * 100) / 100)));
    }
    let band = plotW / chart.labels.length;
    chart.labels.forEach(function (label, index) {
        svg.appendChild(writingSvg("text", { x: left + band * (index + 0.5), y: height - 12, "text-anchor": "middle", "font-size": 12, fill: "#312E81" }, label));
    });
    chart.series.forEach(function (series, seriesIndex) {
        let color = WRITING_COLORS[seriesIndex % WRITING_COLORS.length];
        if (chart.type === "line") {
            let points = series.values.map((value, index) => `${left + band * (index + 0.5)},${top + plotH - (value / ceiling) * plotH}`);
            svg.appendChild(writingSvg("polyline", { points: points.join(" "), fill: "none", stroke: color, "stroke-width": 3 }));
            for (let point of points) {
                let [x, y] = point.split(",");
                svg.appendChild(writingSvg("circle", { cx: x, cy: y, r: 4, fill: color }));
            }
        } else {
            let barW = (band * 0.76) / chart.series.length;
            series.values.forEach(function (value, index) {
                let barH = (value / ceiling) * plotH;
                svg.appendChild(writingSvg("rect", {
                    x: left + band * index + band * 0.12 + barW * seriesIndex, y: top + plotH - barH,
                    width: Math.max(2, barW - 2), height: barH, rx: 3, fill: color
                }));
            });
        }
    });
    box.appendChild(svg);

    let table = ieltsElement("table", "ielts-data");
    let headRow = ieltsElement("tr");
    headRow.appendChild(ieltsElement("th", "", ""));
    for (let label of chart.labels) {
        headRow.appendChild(ieltsElement("th", "", label));
    }
    table.appendChild(headRow);
    chart.series.forEach(function (series, seriesIndex) {
        let row = ieltsElement("tr");
        let name = ieltsElement("th", "", series.name);
        name.style.color = WRITING_COLORS[seriesIndex % WRITING_COLORS.length];
        row.appendChild(name);
        for (let value of series.values) {
            row.appendChild(ieltsElement("td", "", String(value)));
        }
        table.appendChild(row);
    });
    box.appendChild(table);
    return box;
}

// Değerlendirmeye gönderilecek konu metni (grafik verisi ve maddeler dahil)
function writingPromptText() {
    if (!writingData) {
        return "";
    }
    let parts = [writingData.prompt, writingData.instruction || ""];
    if (writingData.bullets) {
        parts.push("In your letter: " + writingData.bullets.join("; "));
    }
    if (writingData.chart) {
        let chart = writingData.chart;
        parts.push(`Chart: ${chart.title} (${chart.unit}). Labels: ${chart.labels.join(", ")}. ` +
            chart.series.map((series) => `${series.name}: ${series.values.join(", ")}`).join(". "));
    }
    return parts.filter(Boolean).join("\n");
}

function writingRenderPrompt() {
    let box = document.getElementById("writingPrompt");
    box.replaceChildren();
    box.hidden = !writingData;
    if (!writingData) {
        return;
    }
    let level = writingData.level ? ` · bant ${writingData.level} seviyesi` : "";
    box.appendChild(ieltsElement("span", "preview-label", `Writing Task ${writingData.task} · ${IELTS_MODULES[writingData.module] || ""}${level}`));
    box.appendChild(ieltsElement("p", "ielts-prompt-text", writingData.prompt));
    if (writingData.chart) {
        box.appendChild(ieltsElement("p", "", "Summarise the information by selecting and reporting the main features, and make comparisons where relevant."));
        box.appendChild(writingChart(writingData.chart));
    }
    if (writingData.bullets) {
        box.appendChild(ieltsElement("p", "", "In your letter:"));
        let list = ieltsElement("ul", "ielts-list");
        for (let bullet of writingData.bullets) {
            list.appendChild(ieltsElement("li", "", bullet));
        }
        box.appendChild(list);
    }
    if (writingData.instruction) {
        box.appendChild(ieltsElement("p", "ielts-prompt-text", writingData.instruction));
    }
    box.appendChild(ieltsElement("p", "lab-note", `Write at least ${writingMinimum()} words. Önerilen süre: ${writingTask === 1 ? 20 : 40} dakika.`));
}

function writingCount() {
    let words = document.getElementById("writingEssay").value.trim().split(/\s+/).filter(Boolean).length;
    let label = document.getElementById("writingWords");
    label.textContent = `${words} kelime · en az ${writingMinimum()}`;
    label.classList.toggle("enough", words >= writingMinimum());
    return words;
}

function writingSaveDraft() {
    ieltsWrite("ielts:writing:draft", { task: writingTask, data: writingData, text: document.getElementById("writingEssay").value });
}

function writingSetTask(task, keepData) {
    writingTask = task === 1 ? 1 : 2;
    for (let button of document.querySelectorAll("#writingTask button")) {
        button.setAttribute("aria-pressed", Number(button.dataset.task) === writingTask ? "true" : "false");
    }
    if (!keepData) {
        writingData = null;
        document.getElementById("writingResult").hidden = true;
    }
    writingTimer.reset(writingTask === 1 ? 20 * 60 : 40 * 60);
    document.getElementById("writingTimerToggle").textContent = "Süreyi başlat";
    writingRenderPrompt();
    writingCount();
}

function writingNew() {
    let button = document.getElementById("writingNew");
    button.disabled = true;
    ieltsStatus("writingStatus", "Konu üretiliyor…");
    ieltsApi("/api/ielts/writing-task", { module: ieltsModule, task: writingTask, level: ieltsLevel("writing") })
        .then(function (data) {
            writingData = data;
            document.getElementById("writingEssay").value = "";
            document.getElementById("writingResult").hidden = true;
            writingRenderPrompt();
            writingCount();
            writingSaveDraft();
            writingTimer.reset(writingTask === 1 ? 20 * 60 : 40 * 60);
            document.getElementById("writingTimerToggle").textContent = "Süreyi başlat";
            ieltsStatus("writingStatus", "Konu hazır. Hazır olunca süreyi başlat.");
        })
        .catch(function (error) { ieltsStatus("writingStatus", error.message, "error"); })
        .finally(function () { button.disabled = false; });
}

function writingRenderResult(result) {
    let box = document.getElementById("writingResult");
    box.replaceChildren();
    box.hidden = false;
    box.appendChild(ieltsElement("h3", "", "Değerlendirme (tahmini)"));

    let tiles = ieltsElement("div", "tiles");
    let overall = ieltsElement("div", "tile ielts-overall");
    overall.append(ieltsElement("span", "tile-label", "Tahmini bant"), ieltsElement("span", "tile-value", result.estimate.toFixed(1)),
        ieltsElement("span", "tile-sub", `ölçüt ortalaması ${result.average}`));
    tiles.appendChild(overall);
    for (let item of IELTS_CRITERIA.writing) {
        let tile = ieltsElement("div", "tile");
        tile.append(ieltsElement("span", "tile-label", item.tr), ieltsElement("span", "tile-value", result.criteria[item.key].band.toFixed(1)));
        tiles.appendChild(tile);
    }
    box.appendChild(tiles);
    if (result.words < result.minimum) {
        box.appendChild(ieltsElement("p", "error", `Cevabın ${result.words} kelime; alt sınır ${result.minimum}. Kısa cevap sınavda puan kaybettirir.`));
    }
    for (let item of IELTS_CRITERIA.writing) {
        let row = ieltsElement("p", "ielts-criterion");
        row.append(ieltsElement("b", "", `${item.name}: `), result.criteria[item.key].comment);
        box.appendChild(row);
    }
    for (let [title, items] of [["Güçlü yanların", result.strengths], ["Geliştirmen gerekenler", result.improvements]]) {
        if (items.length) {
            box.appendChild(ieltsElement("h4", "dict-subtitle", title));
            let list = ieltsElement("ul", "ielts-list");
            for (let text of items) {
                list.appendChild(ieltsElement("li", "", text));
            }
            box.appendChild(list);
        }
    }
    if (result.corrections.length) {
        box.appendChild(ieltsElement("h4", "dict-subtitle", "Düzeltmeler"));
        for (let item of result.corrections) {
            let card = ieltsElement("div", "ielts-correction");
            card.append(ieltsElement("p", "ielts-original", item.original), ieltsElement("p", "ielts-better", item.better));
            if (item.why) {
                card.appendChild(ieltsElement("p", "ielts-explanation", item.why));
            }
            box.appendChild(card);
        }
    }
    box.appendChild(ieltsElement("p", "lab-note", `Yapay zekâ (${result.model}) tahmini; resmi puan değildir. Tahmini bant, dört ölçütün ortalamasının yarım banda aşağı yuvarlanmış hâlidir.`));
    box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function writingReview() {
    let essay = document.getElementById("writingEssay").value;
    let button = document.getElementById("writingReview");
    button.disabled = true;
    ieltsStatus("writingStatus", "Cevabın değerlendiriliyor… Genelde 5-15 saniye.");
    // Hedef bant (yol haritasından) varsa eğitmen geri bildirimi o banda göre yönlendirir
    let target = typeof ieltsProfile.target === "number" ? ieltsProfile.target : null;
    ieltsApi("/api/ielts/writing-review", { module: ieltsModule, task: writingTask, prompt: writingPromptText(), essay: essay, target: target })
        .then(function (result) {
            writingTimer.stop();
            writingRenderResult(result);
            ieltsStatus("writingStatus", "");
            ieltsAddResult({ kind: "writing", title: `Task ${writingTask}`, score: result.estimate, total: 9 });
        })
        .catch(function (error) { ieltsStatus("writingStatus", error.message, "error"); })
        .finally(function () { button.disabled = false; });
}

for (let button of document.querySelectorAll("#writingTask button")) {
    button.addEventListener("click", function () {
        if (Number(button.dataset.task) !== writingTask) {
            writingSetTask(Number(button.dataset.task));
            document.getElementById("writingEssay").value = "";
            writingCount();
            writingSaveDraft();
        }
    });
}
document.getElementById("writingNew").addEventListener("click", writingNew);
document.getElementById("writingReview").addEventListener("click", writingReview);
document.getElementById("writingEssay").addEventListener("input", function () {
    writingCount();
    writingSaveDraft();
});
document.getElementById("writingTimerToggle").addEventListener("click", function (event) {
    if (writingTimer.left <= 0) {
        writingTimer.reset(writingTask === 1 ? 20 * 60 : 40 * 60);
        event.target.textContent = "Süreyi başlat";
    } else if (writingTimer.running) {
        writingTimer.stop();
        event.target.textContent = "Devam et";
    } else {
        writingTimer.start();
        event.target.textContent = "Duraklat";
    }
});


// ===== Speaking =====

let speakingTimer = ieltsTimer(document.getElementById("speakingTimer"), 60, function () {
    ieltsStatus("speakingStatus", "Süre doldu.");
});
let speakingRecorder = null;
let speakingAudioUrl = "";

function speakingShow(data) {
    document.getElementById("speakingBody").hidden = false;
    let part1 = document.getElementById("speakingPart1");
    part1.replaceChildren();
    for (let group of data.part1) {
        part1.appendChild(ieltsElement("h4", "dict-subtitle ielts-plain", group.topic));
        let list = ieltsElement("ol", "ielts-list");
        for (let question of group.questions) {
            list.appendChild(ieltsElement("li", "", question));
        }
        part1.appendChild(list);
    }
    let card = document.getElementById("speakingCard");
    card.replaceChildren(ieltsElement("p", "ielts-prompt-text", data.part2.task), ieltsElement("p", "", "You should say:"));
    let points = ieltsElement("ul", "ielts-list");
    for (let point of data.part2.points) {
        points.appendChild(ieltsElement("li", "", point));
    }
    card.appendChild(points);
    let part3 = document.getElementById("speakingPart3");
    part3.replaceChildren();
    for (let question of data.part3) {
        part3.appendChild(ieltsElement("li", "", question));
    }
    document.getElementById("speakingNotes").value = "";
    speakingTimer.reset(60);
    for (let box of document.querySelectorAll("#speakingChecks input")) {
        box.checked = false;
    }
}

function speakingNew() {
    let button = document.getElementById("speakingNew");
    button.disabled = true;
    ieltsStatus("speakingStatus", "Sorular üretiliyor…");
    ieltsApi("/api/ielts/speaking", { level: ieltsLevel("speaking") })
        .then(function (data) {
            speakingShow(data);
            ieltsStatus("speakingStatus", `Bant ${data.level} seviyesi · sorular hazır. Soruları sesli cevapla; Bölüm 2'de süre tut.`);
        })
        .catch(function (error) { ieltsStatus("speakingStatus", error.message, "error"); })
        .finally(function () { button.disabled = false; });
}

async function speakingToggleRecord() {
    let button = document.getElementById("speakingRecord");
    if (speakingRecorder && speakingRecorder.state === "recording") {
        speakingRecorder.stop();
        return;
    }
    if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") {
        ieltsStatus("speakingStatus", "Bu tarayıcı ses kaydını desteklemiyor.", "error");
        return;
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
        ieltsStatus("speakingStatus", "Mikrofona erişilemedi. Tarayıcının mikrofon iznini kontrol et.", "error");
        return;
    }
    let chunks = [];
    speakingRecorder = new MediaRecorder(stream);
    speakingRecorder.addEventListener("dataavailable", function (event) { chunks.push(event.data); });
    speakingRecorder.addEventListener("stop", function () {
        for (let track of stream.getTracks()) {
            track.stop();
        }
        if (speakingAudioUrl) {
            URL.revokeObjectURL(speakingAudioUrl);
        }
        speakingAudioUrl = URL.createObjectURL(new Blob(chunks, { type: speakingRecorder.mimeType }));
        button.textContent = "● Kendini kaydet";
        button.setAttribute("aria-pressed", "false");
        document.getElementById("speakingPlayback").disabled = false;
        ieltsStatus("speakingStatus", "Kayıt bitti. Dinleyip ölçütlere göre kendini değerlendir.");
    });
    speakingRecorder.start();
    button.textContent = "■ Kaydı bitir";
    button.setAttribute("aria-pressed", "true");
    ieltsStatus("speakingStatus", "Kaydediliyor…");
}

function speakingFillChecks() {
    let list = document.getElementById("speakingChecks");
    list.replaceChildren();
    for (let item of IELTS_CRITERIA.speaking) {
        let row = ieltsElement("li");
        let label = ieltsElement("label", "check");
        let box = ieltsElement("input");
        box.type = "checkbox";
        let text = ieltsElement("span");
        text.append(ieltsElement("b", "", `${item.name}: `), item.hint);
        label.append(box, text);
        row.appendChild(label);
        list.appendChild(row);
    }
}

document.getElementById("speakingNew").addEventListener("click", speakingNew);
document.getElementById("speakingRecord").addEventListener("click", speakingToggleRecord);
document.getElementById("speakingPlayback").addEventListener("click", function () {
    if (speakingAudioUrl) {
        new Audio(speakingAudioUrl).play();
    }
});
document.getElementById("speakingPrep").addEventListener("click", function () {
    speakingTimer.reset(60);
    speakingTimer.start();
    ieltsStatus("speakingStatus", "Hazırlık: not al, konuşma.");
});
document.getElementById("speakingTalk").addEventListener("click", function () {
    speakingTimer.reset(120);
    speakingTimer.start();
    ieltsStatus("speakingStatus", "Konuş: süre bitene kadar durma.");
});


// ===== ielts.js ile bağlantı =====

let ieltsOpened = {};

// Sekme ilk açıldığında listelerini yükler (ielts.js ieltsShowTab çağırır)
function ieltsPracticeOpen(name) {
    if (ieltsOpened[name]) {
        return;
    }
    ieltsOpened[name] = true;
    if (name === "reading") {
        ieltsFillSets("readingOld", "reading");
    } else if (name === "listening") {
        listeningFillVideos();
        ieltsFillSets("listeningOld", "listening");
    }
}

function ieltsPracticeModuleChanged() {
    // Sınav türü değişince açık duran Writing konusu eski türe ait olabilir; kullanıcı yeni konu üretir
}

speakingFillChecks();
ieltsFillLevels();
{
    // Kaldığın Writing taslağını geri getir
    let draft = ieltsRead("ielts:writing:draft", {});
    writingData = draft.data && typeof draft.data === "object" ? draft.data : null;
    writingSetTask(draft.task === 1 ? 1 : 2, true);
    document.getElementById("writingEssay").value = typeof draft.text === "string" ? draft.text : "";
    writingRenderPrompt();
    writingCount();
}
ieltsShowTab(location.hash.slice(1));
