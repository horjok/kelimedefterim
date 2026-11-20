// ===== Video sayfası: "Sondan başa" alıştırması (backward build-up drill) =====
// Uzun bir cümleyi akıcı söylemek için cümle sondan başlayarak parça parça kurulur:
//   "the store."  →  "to the store."  →  "going to the store."  →  "I'm going to the store."
// Böylece cümlenin sonu (çoğu zaman en az çalışılan yer) en çok tekrar edilir ve tonlama doğal kalır.
// Cümle kartındaki (#shadowCard) "Sondan başa" düğmesiyle açılır; ekrandaki cümle (shadowCurrent) üzerinde çalışır.
// Parçalar tarayıcının sesli okumasıyla (speechSynthesis) dinlenir: altyazıda kelime kelime zaman bilgisi yok,
// bu yüzden videodan parça kesilemez. Son adımda (tam cümle) videonun kendi sesi çalar.
// video.js bu dosyadan şunu çağırır: buildupClose() (kartta cümle değişince).

// Bu kelimelerden önce yeni bir parça başlar (edat, bağlaç, tanımlık, yardımcı fiil...)
const BUILDUP_STARTERS = new Set([
    "to", "of", "in", "on", "at", "for", "with", "from", "by", "about", "into", "over", "under", "after", "before",
    "through", "without", "between", "than", "as", "like",
    "and", "but", "or", "so", "because", "if", "when", "while", "that", "which", "who", "where", "what", "how",
    "the", "a", "an", "my", "your", "his", "her", "our", "their", "this", "these", "those", "some", "any",
    "is", "are", "was", "were", "will", "would", "can", "could", "should", "have", "has", "had", "don't", "doesn't", "didn't"
]);
const BUILDUP_MAX_STEPS = 7;

let buildupChunks = [];  // [["I'm", "going"], ["to", "the", "store."]]
let buildupStep = 0;     // kaç parça açık (sondan sayılır); 0 = kapalı

// Söylenmeyen işaretleri (♪, [Music]) atar
function buildupWords(line) {
    return line.text
        .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")  // (rock music), [Applause]
        .split(/\s+/)
        .filter((text) => /[\p{L}\p{N}]/u.test(text));
}

// Cümleyi anlam öbeklerine böler: noktalamadan sonra ve BUILDUP_STARTERS kelimelerinden önce
function buildupSplit(words) {
    let chunks = [];
    words.forEach(function (text, index) {
        let plain = text.toLowerCase().replace(/’/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
        let afterPunctuation = index > 0 && /[,;:.!?…—-]["')\]]*$/.test(words[index - 1]);
        if (index === 0 || afterPunctuation || BUILDUP_STARTERS.has(plain)) {
            chunks.push([]);
        }
        chunks[chunks.length - 1].push(text);
    });
    // Tek kelimelik parçayı sonrakine ekle ("to" + "the store")
    for (let i = chunks.length - 2; i >= 0; i--) {
        if (chunks[i].length === 1) {
            chunks[i + 1] = chunks[i].concat(chunks[i + 1]);
            chunks.splice(i, 1);
        }
    }
    // Çok adım olmasın: en kısa komşu çifti birleştir
    while (chunks.length > BUILDUP_MAX_STEPS) {
        let best = 0;
        for (let i = 1; i < chunks.length - 1; i++) {
            if (chunks[i].length + chunks[i + 1].length < chunks[best].length + chunks[best + 1].length) {
                best = i;
            }
        }
        chunks[best] = chunks[best].concat(chunks[best + 1]);
        chunks.splice(best + 1, 1);
    }
    return chunks;
}

function buildupText() {
    return buildupChunks.slice(buildupChunks.length - buildupStep).flat().join(" ");
}

function buildupRender() {
    let total = buildupChunks.length;
    let firstOpen = total - buildupStep;  // bu parça ve sonrası söylenir
    let box = document.getElementById("buildupText");
    box.replaceChildren();
    buildupChunks.forEach(function (chunk, index) {
        let span = document.createElement(index === firstOpen ? "mark" : "span");
        span.className = index < firstOpen ? "buildup-wait" : "buildup-say";
        span.textContent = chunk.join(" ");
        box.append(span, " ");
    });
    document.getElementById("buildupStep").textContent = `Adım ${buildupStep} / ${total}`;
    document.getElementById("buildupPrev").disabled = buildupStep <= 1;
    document.getElementById("buildupNext").disabled = buildupStep >= total;
    let last = buildupStep >= total;
    document.getElementById("buildupListen").textContent = last ? "▶ Videodan dinle" : "🔊 Dinle";
    document.getElementById("buildupHint").textContent = last
        ? "Cümlenin tamamı. Videodan dinle ve aynı hız ve tonlamayla söyle."
        : "Sarı parça yeni eklendi. Koyu yazılan kısmı dinle, yüksek sesle tekrar et, sonra bir parça daha ekle.";
}

function buildupSpeak() {
    if (buildupStep === 0) {
        return;
    }
    if ("speechSynthesis" in window) {
        speechSynthesis.cancel();
    }
    if (buildupStep >= buildupChunks.length && playerReady()) {
        playFrom(Math.max(0, shadowCurrent));  // tam cümle: videonun kendi sesi, sonunda durur
        updateShadowBar();
        return;
    }
    if (playerReady()) {
        player.pauseVideo();
    }
    if (!("speechSynthesis" in window)) {
        document.getElementById("buildupHint").textContent = "Tarayıcın sesli okumayı desteklemiyor; parçayı kendin oku.";
        return;
    }
    let speech = new SpeechSynthesisUtterance(buildupText());
    speech.lang = langTts();
    speech.rate = 0.9;
    speechSynthesis.speak(speech);
}

function buildupGo(step) {
    buildupStep = Math.min(buildupChunks.length, Math.max(1, step));
    buildupRender();
    buildupSpeak();
}

function buildupOpen() {
    let line = lines[Math.max(0, shadowCurrent)];
    let note = document.getElementById("shadowRecordNote");
    let words = line ? buildupWords(line) : [];
    if (words.length < 2) {
        note.className = "shadow-record-note";
        note.textContent = "Bu cümle sondan başa kurmak için çok kısa.";
        return;
    }
    note.textContent = "";
    buildupChunks = buildupSplit(words);
    document.getElementById("buildupPanel").hidden = false;
    document.getElementById("buildupOpen").setAttribute("aria-pressed", "true");
    buildupGo(1);
}

// Kapat: düğmeyle ya da kartta cümle değişince (video.js renderShadowCard çağırır)
function buildupClose() {
    if (buildupStep === 0) {
        return;
    }
    buildupStep = 0;
    buildupChunks = [];
    if ("speechSynthesis" in window) {
        speechSynthesis.cancel();
    }
    document.getElementById("buildupPanel").hidden = true;
    document.getElementById("buildupOpen").setAttribute("aria-pressed", "false");
}

document.getElementById("buildupOpen").addEventListener("click", function () {
    if (buildupStep > 0) {
        buildupClose();
    } else {
        buildupOpen();
    }
});
document.getElementById("buildupPrev").addEventListener("click", function () { buildupGo(buildupStep - 1); });
document.getElementById("buildupNext").addEventListener("click", function () { buildupGo(buildupStep + 1); });
document.getElementById("buildupListen").addEventListener("click", buildupSpeak);
document.getElementById("buildupEnd").addEventListener("click", buildupClose);
