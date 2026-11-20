// ===== Video diktesi =====
// Üç alıştırma türü (dictationMode):
//   "fill"     Boşluk: cümledeki bazı kelimeler boşluk olur; yazılır ya da çip sürüklenir
//   "arrange"  Sırala: cümlenin kelimeleri karışık gelir; sırayla dokunarak cümle kurulur
//   "sentence" Cümle:  cümlenin tamamı yazılır
// Zorluk (dictationDifficulty) yalnızca Boşluk türünde hangi kelimelerin gizleneceğini belirler.
// Sağdaki transkript dikte modunda noktalarla maskelenir (dictationRenderMask).

let dictationLines = null;
let dictationVocab = null;
let dictationRestoreProgress = false;
let dictationVideoId = "";
let dictationSentences = [];
let dictationIndex = 0;
let dictationMode = "fill";
let dictationDifficulty = "easy";
let dictationStarted = false;      // "Başla"ya basılana kadar önizleme görünür
let dictationLevels = ["B1", "B2", "C1", "C2"];
let dictationAllWords = false;
let dictationAnswers = {};
let dictationAssignments = {};
let dictationLocked = {};
let dictationOrder = [];           // Sırala: yerleştirilen çiplerin sırası (kelime numaraları)
let dictationHintCount = 0;        // Sırala / Cümle: bu cümlede alınan ipucu sayısı
let dictationDoneLines = {};       // bitirilen satırlar: maskeli transkriptte açık yazılır
let dictationRevealed = false;
let dictationCompleted = false;
let dictationFocusedSlot = -1;
let dictationCorrectTotal = 0;
let dictationWordTotal = 0;
let dictationSeekGuard = 0;       // atladıktan hemen sonra oynatıcı bir an eski zamanı bildirebilir
let dictationPausedAtEnd = false;  // ekrandaki cümlenin sonunda biz durdurduk
let dictationAdvanceTimer = null;  // doğru bitince sonraki cümleye geçiş zamanlayıcısı
let dictationDraggedChip = null;
let dictationDragPreview = null;
let dictationWasDragged = false;
let dictationDragStart = null;   // sürükleme başlangıç noktası: küçük titremeler sürükleme sayılmasın
let dictationSpeed = 1;
let dictationLoop = false;       // "Otomatik tekrar": cümle çözülene kadar kendiliğinden yeniden çalar
let dictationLoopAt = 0;         // otomatik tekrarın başlayacağı an (Date.now()); 0 = bekleyen tekrar yok
let dictationWrongs = {};        // satır numarası → o cümlede yapılan yanlış sayısı (maskeli listede görünür)
let dictationChoicesOpen = true; // zorluk/tür seçimi görünür mü (Başla'dan sonra ⚙ ile açılır)
let dictationScored = {};        // puanı yazılmış cümleler (anahtar: cümlenin başlangıç saniyesi)
let dictationHinted = {};        // Boşluk: ipucu alınan boşluklar, ilk denemede doğru sayılmaz

const DICTATION_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const DICTATION_MODES = ["fill", "arrange", "sentence"];
// Zorluk → boşluk yapılacak seviyeler. "hard" her kelimeyi boşluk yapar (tam dikte).
const DICTATION_DIFFICULTY = {
    easy: ["B1", "B2", "C1", "C2"],
    medium: DICTATION_LEVELS,
    hard: DICTATION_LEVELS
};
const DICTATION_WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function dictationNormalize(value) {
    return String(value || "").replace(/[’]/g, "'").toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

// Cevap karşılaştırması. İngilizce dışındaki dillerde vurgu işaretleri yok sayılır: Türkçe klavyede á, ñ yok,
// "estacion" yazan "estación" bilmiş sayılır (doğru yazım cevapta yine görünür).
function dictationAnswerNormalize(value) {
    let text = dictationNormalize(value).replace(/[^\p{L}\p{N}']/gu, "");
    return currentLang() === LANG_DEFAULT ? text : text.normalize("NFD").replace(/\p{M}/gu, "");
}

function dictationStorageKey(suffix) {
    return `dictation:${dictationVideoId}:${suffix}`;
}

// Cümle sırası yerine başlangıç saniyesini sakla: zorluk ya da tür değişince cümle listesi değişse de
// kullanıcı videoda aynı yerden devam eder.
function dictationSaveProgress() {
    if (!dictationVideoId || !dictationSentences.length) return;
    try {
        localStorage.setItem(dictationStorageKey("progress"), JSON.stringify({
            start: dictationSentences[dictationIndex].line.start,
            correct: dictationCorrectTotal,
            total: dictationWordTotal,
            scored: Object.keys(dictationScored)
        }));
    } catch (error) { }
}

function dictationSentenceKey(sentence) {
    return String(sentence.line.start);
}

function dictationShuffle(items) {
    let result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    // Karışık hali cevap sırasıyla aynı kaldıysa bir kez kaydır
    if (result.length > 1 && result.every((item, index) => item === items[index])) {
        result.push(result.shift());
    }
    return result;
}

function dictationApplyDifficulty() {
    dictationLevels = DICTATION_DIFFICULTY[dictationDifficulty];
    dictationAllWords = dictationDifficulty === "hard";
}

function dictationLoadPreferences() {
    try {
        let savedMode = localStorage.getItem("dictation:mode");
        if (DICTATION_MODES.includes(savedMode)) dictationMode = savedMode;
        let savedDifficulty = localStorage.getItem("dictation:difficulty");
        if (savedDifficulty in DICTATION_DIFFICULTY) {
            dictationDifficulty = savedDifficulty;
        } else if (localStorage.getItem("dictation:all") === "true") {
            dictationDifficulty = "hard";  // eski "Tam dikte" ayarı
        }
    } catch (error) { }
    dictationApplyDifficulty();
}

function dictationSavePreferences() {
    try {
        localStorage.setItem("dictation:mode", dictationMode);
        localStorage.setItem("dictation:difficulty", dictationDifficulty);
    } catch (error) { }
}

function dictationReset() {
    dictationCancelAdvance();
    dictationLines = null;
    dictationVocab = null;
    dictationVideoId = "";
    dictationSentences = [];
    dictationIndex = 0;
    dictationStarted = false;
    dictationAnswers = {};
    dictationAssignments = {};
    dictationLocked = {};
    dictationOrder = [];
    dictationDoneLines = {};
    dictationWrongs = {};
    dictationLoopAt = 0;
    dictationCorrectTotal = 0;
    dictationWordTotal = 0;
    dictationScored = {};
    dictationHinted = {};
    dictationRevealed = false;
    dictationCompleted = false;
    document.getElementById("dictationCounter").textContent = "Transkript ve kelimeler bekleniyor…";
    dictationSetModeCount("");
    dictationRenderScore();
    dictationShowExercise(false);
    document.getElementById("dictationStart").disabled = true;
    document.getElementById("dictationSentence").textContent = "";
    document.getElementById("dictationBank").textContent = "";
    document.getElementById("dictationMessage").textContent = "";
    dictationRenderMask();
}

function dictationSetLines(lines, videoId) {
    dictationLines = lines || [];
    dictationVideoId = videoId || "";
    dictationRestoreProgress = true;
    dictationRebuildSentences();
}

function dictationSetVocab(vocab) {
    dictationVocab = vocab;
    dictationRebuildSentences();
}

function dictationBuildWordSet() {
    let forms = new Set();
    if (!dictationVocab || !dictationVocab.levels) return forms;
    for (let level of dictationLevels) {
        for (let item of (dictationVocab.levels[level] || [])) {
            let itemForms = Array.isArray(item.forms) ? item.forms : [item.word];
            for (let form of itemForms) {
                let normalized = dictationNormalize(form);
                if (normalized) forms.add(normalized);
            }
        }
    }
    return forms;
}

function dictationRebuildSentences() {
    if (!dictationLines || !dictationVocab) {
        document.getElementById("dictationCounter").textContent = "Transkript ve kelimeler yükleniyor…";
        dictationRenderMask();
        return;
    }

    // Yeniden kurulumdan sonra hangi cümlede duracağımızı belirle
    let targetStart = null;
    if (dictationRestoreProgress) {
        dictationCorrectTotal = 0;
        dictationWordTotal = 0;
        dictationScored = {};
        try {
            let saved = JSON.parse(localStorage.getItem(dictationStorageKey("progress")) || "null");
            if (saved) {
                targetStart = typeof saved.start === "number" ? saved.start : null;
                dictationCorrectTotal = Number(saved.correct) || 0;
                dictationWordTotal = Number(saved.total) || 0;
                for (let key of (Array.isArray(saved.scored) ? saved.scored : [])) dictationScored[key] = true;
            }
        } catch (error) { }
        dictationRestoreProgress = false;
    } else if (dictationSentences[dictationIndex]) {
        targetStart = dictationSentences[dictationIndex].line.start;
    }

    let wordSet = dictationBuildWordSet();
    dictationSentences = [];
    dictationLines.forEach(function (line, lineIndex) {
        let parts = [];
        let holes = [];
        let words = [];   // cümlenin tüm kelimeleri (Sırala ve Cümle türleri için)
        let cursor = 0;
        let pattern = /\[[^\]]*\]|\([^)]*\)|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
        let match;
        while ((match = pattern.exec(line.text)) !== null) {
            if (match.index > cursor) parts.push({ text: line.text.slice(cursor, match.index) });
            let token = match[0];
            let isTag = /^\[|^\(/.test(token);
            let isNumber = /^[\p{N}]+$/u.test(token);
            let normalized = dictationNormalize(token);
            if (!isTag && normalized) words.push(token);
            let isHole = !isTag && !isNumber && normalized && (dictationAllWords || wordSet.has(normalized));
            if (isHole) {
                let holeIndex = holes.length;
                holes.push({ word: token, normalized: normalized, source: holes.length });
                parts.push({ hole: holeIndex });
            } else {
                parts.push({ text: token });
            }
            cursor = match.index + token.length;
        }
        if (cursor < line.text.length) parts.push({ text: line.text.slice(cursor) });
        // Boşluk türünde boşluğu olmayan cümle atlanır; diğer türlerde her cümle sorulur
        let usable = dictationMode === "fill" ? holes.length > 0 : words.length > 0;
        if (usable) dictationSentences.push({ line: line, lineIndex: lineIndex, parts: parts, holes: holes, words: words });
    });

    dictationIndex = 0;
    if (targetStart !== null) {
        let found = dictationSentences.findIndex((sentence) => sentence.line.start >= targetStart - 0.01);
        dictationIndex = found >= 0 ? found : Math.max(0, dictationSentences.length - 1);
    }
    dictationRender();
}


// ===== Zorluk ve tür seçimi, önizleme =====

function dictationRenderChoices() {
    document.querySelectorAll("#dictationDifficulty button").forEach(function (button) {
        button.setAttribute("aria-pressed", button.dataset.value === dictationDifficulty);
        button.disabled = dictationMode !== "fill";  // zorluk yalnızca Boşluk türünü etkiler
    });
    document.querySelectorAll("#dictationModeSelect button").forEach(function (button) {
        button.setAttribute("aria-pressed", button.dataset.value === dictationMode);
    });
    document.getElementById("dictationDifficulty").title = dictationMode === "fill"
        ? "Kaç kelimenin gizleneceği"
        : "Zorluk yalnızca Boşluk türünde geçerli";
}

function dictationPreviewBlank() {
    let blank = document.createElement("span");
    blank.className = "preview-blank";
    return blank;
}

// Başlamadan önce: seçilen türün küçük bir örneği
function dictationRenderPreview() {
    let sample = document.getElementById("dictationPreviewSample");
    let text = document.getElementById("dictationPreviewText");
    sample.replaceChildren();

    if (dictationMode === "fill") {
        if (dictationDifficulty === "hard") {
            sample.append(dictationPreviewBlank(), " ", dictationPreviewBlank(), " ", dictationPreviewBlank(), " ", dictationPreviewBlank(), " ", dictationPreviewBlank());
            text.textContent = "Her kelime gizli: tam dikte";
        } else if (dictationDifficulty === "medium") {
            sample.append("I ", dictationPreviewBlank(), " ", dictationPreviewBlank(), " to music while I ", dictationPreviewBlank(), " ", dictationPreviewBlank(), ".");
            text.textContent = "Çok yaygın olanlar dışındaki kelimeler gizli · her boşluğu doldur";
        } else {
            sample.append("I usually ", dictationPreviewBlank(), " to music while I ", dictationPreviewBlank(), " dinner.");
            text.textContent = "Bazı anahtar kelimeler gizli · her boşluğu doldur";
        }
    } else if (dictationMode === "arrange") {
        for (let word of ["music", "I", "to", "listen"]) {
            let chip = document.createElement("span");
            chip.className = "preview-chip";
            chip.textContent = word;
            sample.appendChild(chip);
        }
        text.textContent = "Kelimeler karışık gelir · sırayla dokunup cümleyi kur";
    } else {
        let line = document.createElement("span");
        line.className = "preview-line";
        sample.appendChild(line);
        text.textContent = "Cümleyi dinle ve tamamını yaz";
    }

    let start = document.getElementById("dictationStart");
    start.disabled = dictationSentences.length === 0;
    start.textContent = dictationIndex > 0 ? `▶ Devam et (cümle ${dictationIndex + 1})` : "▶ Başla";
}

function dictationShowExercise(started) {
    document.getElementById("dictationPreview").hidden = started;
    document.getElementById("dictationExercise").hidden = !started;
    if (!started) {
        dictationSetChoicesOpen(true);  // başlamadan önce seçimler hep görünür
    }
}

// Başladıktan sonra zorluk/tür seçimi yer kaplamasın: ⚙ Ayarlar ile açılıp kapanır
function dictationSetChoicesOpen(open) {
    dictationChoicesOpen = open;
    document.getElementById("dictationChoices").hidden = !open;
    let gear = document.getElementById("dictationGear");
    gear.hidden = !dictationStarted;
    gear.setAttribute("aria-expanded", String(open));
}

function dictationChoose(kind, value) {
    if (kind === "mode") {
        if (!DICTATION_MODES.includes(value) || value === dictationMode) return;
        dictationMode = value;
    } else {
        if (!(value in DICTATION_DIFFICULTY) || value === dictationDifficulty) return;
        dictationDifficulty = value;
        dictationApplyDifficulty();
    }
    dictationSavePreferences();
    dictationRenderChoices();
    // Alıştırma başladıysa yeni ayarla aynı cümleden sürer: yeniden "Başla"ya basmak gerekmez.
    // Henüz başlamadıysa önizleme yeni ayara göre güncellenir.
    dictationRebuildSentences();
    dictationFocusAnswer();
}

function dictationStart() {
    if (!dictationSentences.length) return;
    dictationStarted = true;
    dictationRender();
    dictationSetChoicesOpen(false);
    dictationPlayCurrent();
    dictationFocusAnswer();
}


// ===== Maskeli transkript (sağdaki panel) =====

// Harfler nokta olur; rakam ve noktalama kalır
function dictationMaskText(text) {
    return text.replace(/\p{L}/gu, "•");
}

function dictationRenderMask() {
    let container = document.getElementById("maskLines");
    if (!container) return;
    let count = document.getElementById("maskCount");
    container.replaceChildren();
    if (!dictationLines) {
        if (count) count.textContent = "";
        return;
    }
    if (count) count.textContent = `${dictationLines.length} cümle`;

    let current = dictationSentences[dictationIndex];
    let currentLine = current ? current.lineIndex : -1;
    let activeRow = null;

    dictationLines.forEach(function (line, lineIndex) {
        let row = document.createElement("button");
        row.type = "button";
        row.className = "line mask-line";
        let done = Boolean(dictationDoneLines[lineIndex]);
        if (done) row.classList.add("done");
        if (lineIndex === currentLine) {
            row.classList.add("active");
            activeRow = row;
        }
        row.title = "Dikteyi bu cümleden sürdür";
        row.addEventListener("click", function () {
            dictationGoToLine(lineIndex);
        });

        let number = document.createElement("span");
        number.className = "line-time mask-number";
        number.textContent = done ? "✓" : String(lineIndex + 1);
        let text = document.createElement("span");
        text.className = "mask-text";
        text.textContent = done ? line.text : dictationMaskText(line.text);
        row.append(number, text);
        if (dictationWrongs[lineIndex]) {
            let wrong = document.createElement("span");
            wrong.className = "mask-wrong";
            wrong.textContent = `${dictationWrongs[lineIndex]} yanlış`;
            row.appendChild(wrong);
        }
        container.appendChild(row);
    });

    // Geniş ekranda transkript kutusu kendi içinde kayar: sıradaki cümle görünür kalsın
    let box = document.getElementById("transcript");
    if (activeRow && box && !box.hidden && box.scrollHeight > box.clientHeight + 1) {
        box.scrollTo({ top: activeRow.offsetTop - box.clientHeight / 3, behavior: "smooth" });
    }
}

function dictationGoToLine(lineIndex) {
    if (!dictationSentences.length) return;
    // Boşluk türünde her satır soru değildir: o satırdan sonraki ilk soruya git
    let found = dictationSentences.findIndex((sentence) => sentence.lineIndex >= lineIndex);
    dictationIndex = found >= 0 ? found : dictationSentences.length - 1;
    dictationRender();
    if (dictationStarted) {
        dictationPlayCurrent();
        dictationFocusAnswer();
    }
}


// ===== Ekrana çizme =====

function dictationSetMessage(message, className) {
    let element = document.getElementById("dictationMessage");
    element.textContent = message;
    element.className = className ? `dictation-message ${className}` : "dictation-message";
}

function dictationRenderScore() {
    document.getElementById("dictationScore").textContent =
        `İlk denemede doğru: ${dictationCorrectTotal} / ${dictationWordTotal} kelime`;
}

// Mod kartındaki "Dikte 3/37" sayacı
function dictationSetModeCount(text) {
    let element = document.getElementById("dictationModeCount");
    if (element) element.textContent = text;
}

function dictationRender() {
    dictationCancelAdvance();
    dictationPausedAtEnd = false;
    dictationLoopAt = 0;
    document.getElementById("dictationTranslation").hidden = true;
    document.getElementById("dictationGrammar").hidden = true;
    let counter = document.getElementById("dictationCounter");
    let sentenceBox = document.getElementById("dictationSentence");
    let bank = document.getElementById("dictationBank");
    dictationRenderScore();
    dictationRenderChoices();
    sentenceBox.replaceChildren();
    bank.replaceChildren();
    dictationAnswers = {};
    dictationAssignments = {};
    dictationLocked = {};
    dictationHinted = {};
    dictationOrder = [];
    dictationHintCount = 0;
    dictationFocusedSlot = -1;
    dictationRevealed = false;
    dictationCompleted = false;
    dictationSetMessage("");

    if (!dictationSentences.length) {
        dictationSetModeCount("");
        dictationStarted = false;
        dictationShowExercise(false);
        dictationRenderPreview();
        dictationRenderMask();
        counter.textContent = "Bu zorlukta boşluk içeren cümle yok.";
        dictationSetMessage("Orta ya da Zor'u seç; daha çok kelime gizlenir.");
        return;
    }

    dictationIndex = Math.min(dictationIndex, dictationSentences.length - 1);
    let sentence = dictationSentences[dictationIndex];
    counter.textContent = `Cümle ${dictationIndex + 1} / ${dictationSentences.length}`;
    dictationSetModeCount(`${dictationIndex + 1}/${dictationSentences.length}`);
    document.getElementById("dictationPrevious").disabled = dictationIndex === 0;
    document.getElementById("dictationNext").textContent = dictationIndex === dictationSentences.length - 1 ? "Bitir ▶" : "Sonraki ▶";
    dictationSaveProgress();
    dictationShowExercise(dictationStarted);
    dictationRenderMask();

    if (!dictationStarted) {
        dictationRenderPreview();
        return;
    }
    // Not: burada otomatik oynatma yok. Render ayar değişince ve kelimeler yüklenince de çalışıyor;
    // video yalnızca kullanıcı cümle değiştirdiğinde (Başla/Önceki/Sonraki/Baştan) çalar.
    if (dictationMode === "arrange") {
        dictationRenderArrange(sentence);
    } else if (dictationMode === "sentence") {
        dictationRenderTyped(sentence);
    } else {
        dictationRenderFill(sentence);
    }
}

function dictationRenderFill(sentence) {
    let sentenceBox = document.getElementById("dictationSentence");
    let bank = document.getElementById("dictationBank");
    let chips = [];
    for (let part of sentence.parts) {
        if (part.text !== undefined) {
            sentenceBox.appendChild(document.createTextNode(part.text));
            continue;
        }
        let slotIndex = part.hole;
        let slot = document.createElement("input");
        slot.type = "text";
        slot.className = "dictation-slot";
        slot.autocomplete = "off";
        slot.spellcheck = false;
        slot.setAttribute("aria-label", `Boşluk ${slotIndex + 1}`);
        slot.setAttribute("autocapitalize", "none");
        // Boşluğun genişliği kelimenin uzunluğunu sezdirir
        slot.style.width = `${Math.max(3, sentence.holes[slotIndex].word.length + 2)}ch`;
        slot.addEventListener("focus", function () { dictationFocusedSlot = slotIndex; });
        slot.addEventListener("input", function () {
            dictationAnswers[slotIndex] = slot.value;
            if (dictationAssignments[slotIndex] !== undefined) delete dictationAssignments[slotIndex];
            dictationRefreshBank();
            slot.classList.remove("wrong");
        });
        slot.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                dictationCheck();
            }
        });
        sentenceBox.appendChild(slot);
        dictationAnswers[slotIndex] = "";
        let chip = document.createElement("button");
        chip.type = "button";
        chip.className = "dictation-chip";
        chip.textContent = sentence.holes[slotIndex].word;
        chip.dataset.chip = String(slotIndex);
        chip.setAttribute("aria-label", `Kelimeyi yerleştir: ${sentence.holes[slotIndex].word}`);
        chip.addEventListener("click", function () {
            if (dictationWasDragged) {
                dictationWasDragged = false;
                return;
            }
            dictationPlaceChip(slotIndex);
        });
        chips.push(chip);
    }
    // Çipler cevap sırasıyla dursa cümleyi ele verirdi
    bank.append(...dictationShuffle(chips));
    dictationRefreshBank();
}

function dictationSlotElements() {
    return Array.from(document.querySelectorAll("#dictationSentence .dictation-slot"));
}

function dictationRefreshBank() {
    let used = new Set(Object.values(dictationAssignments).map(String));
    document.querySelectorAll("#dictationBank .dictation-chip").forEach(function (chip) {
        let isUsed = used.has(chip.dataset.chip);
        chip.classList.toggle("used", isUsed);
        chip.setAttribute("aria-pressed", String(isUsed));
    });
}

function dictationPlaceChip(chipIndex, targetIndex) {
    let slots = dictationSlotElements();
    if (targetIndex === undefined) {
        targetIndex = dictationFocusedSlot;
        if (targetIndex < 0 || (slots[targetIndex] && slots[targetIndex].disabled)) {
            targetIndex = slots.findIndex((slot, index) => !slot.value && !slot.disabled);
        }
    }
    if (targetIndex < 0 || !slots[targetIndex] || slots[targetIndex].disabled) return;
    for (let key of Object.keys(dictationAssignments)) {
        // Doğru diye kilitlenmiş boşluktaki çip yerinden alınamaz
        if (dictationAssignments[key] === chipIndex && dictationLocked[key]) return;
    }
    for (let key of Object.keys(dictationAssignments)) {
        if (dictationAssignments[key] === chipIndex) {
            delete dictationAssignments[key];
            slots[Number(key)].value = "";
            dictationAnswers[key] = "";
        }
    }
    dictationAssignments[targetIndex] = chipIndex;
    let word = dictationSentences[dictationIndex].holes[chipIndex].word;
    slots[targetIndex].value = word;
    dictationAnswers[targetIndex] = word;
    slots[targetIndex].focus();
    dictationFocusedSlot = targetIndex;
    dictationRefreshBank();
}


// ===== Sırala türü =====

function dictationRenderArrange(sentence) {
    let bank = document.getElementById("dictationBank");
    let chips = sentence.words.map(function (word, wordIndex) {
        let chip = document.createElement("button");
        chip.type = "button";
        chip.className = "dictation-chip";
        chip.textContent = word;
        chip.dataset.chip = String(wordIndex);
        chip.addEventListener("click", function () {
            if (dictationCompleted || dictationOrder.includes(wordIndex)) return;
            dictationOrder.push(wordIndex);
            dictationRefreshArrange();
        });
        return chip;
    });
    bank.append(...dictationShuffle(chips));
    dictationRefreshArrange();
}

// marks: kontrol sonrası her yerleştirilen kelime için "correct" | "wrong" | "shown" (yoksa işaretsiz)
function dictationRefreshArrange(marks) {
    let sentence = dictationSentences[dictationIndex];
    let sentenceBox = document.getElementById("dictationSentence");
    sentenceBox.replaceChildren();

    if (dictationOrder.length === 0) {
        let placeholder = document.createElement("span");
        placeholder.className = "dictation-placeholder";
        placeholder.textContent = "Aşağıdaki kelimelere sırayla dokun: cümleyi kur.";
        sentenceBox.appendChild(placeholder);
    }
    dictationOrder.forEach(function (wordIndex, position) {
        let placed = document.createElement("button");
        placed.type = "button";
        placed.className = "dictation-chip placed";
        if (marks && marks[position]) placed.classList.add(marks[position]);
        placed.textContent = sentence.words[wordIndex];
        placed.title = "Geri almak için dokun";
        placed.disabled = dictationCompleted;
        placed.addEventListener("click", function () {
            dictationOrder.splice(position, 1);
            dictationRefreshArrange();
        });
        sentenceBox.appendChild(placed);
    });

    document.querySelectorAll("#dictationBank .dictation-chip").forEach(function (chip) {
        let isUsed = dictationOrder.includes(Number(chip.dataset.chip));
        chip.classList.toggle("used", isUsed);
        chip.disabled = isUsed || dictationCompleted;
    });
}

// Yerleştirilen kelime o sıradaki doğru kelimeyle aynı mı? (Aynı kelimenin iki kopyası yer değiştirebilir.)
function dictationArrangeCorrect(sentence, position) {
    return dictationAnswerNormalize(sentence.words[dictationOrder[position]]) === dictationAnswerNormalize(sentence.words[position]);
}

function dictationArrangePrefix(sentence) {
    let length = 0;
    while (length < dictationOrder.length && dictationArrangeCorrect(sentence, length)) length++;
    return length;
}


// ===== Cümle türü =====

function dictationRenderTyped(sentence) {
    let sentenceBox = document.getElementById("dictationSentence");
    let input = document.createElement("textarea");
    input.className = "dictation-typed";
    input.id = "dictationTyped";
    input.rows = 2;
    input.placeholder = "Duyduğun cümleyi yaz…";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "none");
    input.setAttribute("aria-label", "Cümleyi yaz");
    input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            dictationCheck();
        }
    });
    let feedback = document.createElement("div");
    feedback.className = "dictation-feedback";
    feedback.id = "dictationFeedback";
    sentenceBox.append(input, feedback);
}

function dictationTypedTokens(value) {
    return (String(value).match(DICTATION_WORD) || []).map(dictationAnswerNormalize);
}

// Beklenen kelimelerden hangileri yazılmış? Araya eksik ya da fazla kelime girse de sıra korunarak eşleştirilir
// (en uzun ortak alt dizi). Dönen dizi: beklenen her kelime için true/false.
function dictationMatchWords(expected, typed) {
    let rows = expected.length + 1;
    let columns = typed.length + 1;
    let table = Array.from({ length: rows }, () => new Array(columns).fill(0));
    for (let i = expected.length - 1; i >= 0; i--) {
        for (let j = typed.length - 1; j >= 0; j--) {
            table[i][j] = expected[i] === typed[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    let matched = new Array(expected.length).fill(false);
    let i = 0;
    let j = 0;
    while (i < expected.length && j < typed.length) {
        if (expected[i] === typed[j]) {
            matched[i] = true;
            i++;
            j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            i++;
        } else {
            j++;
        }
    }
    return matched;
}

// Doğru yazılan kelimeler açık, eksikler noktalı gösterilir
function dictationRenderFeedback(sentence, matched) {
    let feedback = document.getElementById("dictationFeedback");
    feedback.replaceChildren();
    sentence.words.forEach(function (word, index) {
        let item = document.createElement("span");
        item.className = matched[index] ? "feedback-ok" : "feedback-miss";
        item.textContent = matched[index] ? word : dictationMaskText(word);
        feedback.append(item, " ");
    });
}


// ===== Kontrol, ipucu, cevabı göster =====

// Puan: her cümlenin yalnızca ilk kontrolü sayılır (geri dönüp tekrar çözmek puanı şişirmez)
function dictationScoreOnce(sentence, correct, total) {
    let key = dictationSentenceKey(sentence);
    if (dictationScored[key]) return;
    dictationScored[key] = true;
    dictationCorrectTotal += correct;
    dictationWordTotal += total;
    dictationRenderScore();
    dictationSaveProgress();
}

// Kontrolde çıkan yanlışlar: maskeli listede o cümlenin yanında toplam olarak görünür
function dictationAddWrong(sentence, count) {
    if (count <= 0) return;
    dictationWrongs[sentence.lineIndex] = (dictationWrongs[sentence.lineIndex] || 0) + count;
    dictationRenderMask();
}

// Biten cümlede geçen gramer konuları (grammar.js; yalnızca Gramer modu bu video için yüklendiyse)
function dictationRenderGrammar() {
    let box = document.getElementById("dictationGrammar");
    box.replaceChildren();
    box.hidden = true;
    if (!dictationStarted || !dictationCompleted || typeof grammarForLine !== "function") return;
    let sentence = dictationSentences[dictationIndex];
    let items = sentence ? grammarForLine(sentence.lineIndex) : [];
    if (!items.length) return;
    let label = document.createElement("span");
    label.className = "dictation-grammar-label";
    label.textContent = "Bu cümledeki gramer";
    box.appendChild(label);
    for (let item of items) {
        let button = document.createElement("button");
        button.type = "button";
        button.className = "dictation-grammar-item";
        button.title = "Gramer modunda aç";
        let title = document.createElement("b");
        title.textContent = item.title;
        button.append(title, item.phrase ? ` · “${item.phrase}”` : "");
        if (item.note) {
            let note = document.createElement("span");
            note.textContent = item.note;
            button.appendChild(note);
        }
        button.addEventListener("click", function () {
            dictationCancelAdvance();
            grammarShowTopic(item.topicIndex);
        });
        box.appendChild(button);
    }
    box.hidden = false;
}

function dictationMarkDone(sentence) {
    dictationCompleted = true;
    dictationDoneLines[sentence.lineIndex] = true;
    dictationRenderMask();  // biten cümle transkriptte açılır
    dictationSaveProgress();
    dictationRenderGrammar();
}

function dictationComplete(sentence) {
    dictationMarkDone(sentence);
    if (dictationIndex < dictationSentences.length - 1) {
        // Kısa bir başarı mesajından sonra kendiliğinden sonraki cümle
        dictationSetMessage("Harika! Hepsi doğru. Sonraki cümleye geçiliyor…", "success");
        let finishedIndex = dictationIndex;
        dictationAdvanceTimer = setTimeout(function () {
            dictationAdvanceTimer = null;
            if (dictationIndex === finishedIndex && dictationCompleted) dictationNext();
        }, 1400);
    } else {
        dictationFinish();
    }
}

function dictationCheck() {
    if (!dictationStarted || !dictationSentences.length || dictationCompleted) return;
    let sentence = dictationSentences[dictationIndex];

    if (dictationMode === "arrange") {
        let marks = dictationOrder.map((wordIndex, position) => dictationArrangeCorrect(sentence, position) ? "correct" : "wrong");
        let correct = marks.filter((mark) => mark === "correct").length;
        dictationScoreOnce(sentence, Math.max(0, correct - dictationHintCount), sentence.words.length);
        if (correct === sentence.words.length) {
            dictationCompleted = true;
            dictationRefreshArrange(marks);
            dictationComplete(sentence);
        } else {
            dictationRefreshArrange(marks);
            dictationAddWrong(sentence, Math.max(1, marks.length - correct));
            dictationSetMessage(dictationOrder.length < sentence.words.length
                ? "Cümle henüz tamam değil. Kalan kelimeleri de yerleştir."
                : "Kırmızı kelimeler yanlış yerde. Dokunup geri al, yeniden diz.", "error");
        }
        return;
    }

    if (dictationMode === "sentence") {
        let expected = sentence.words.map(dictationAnswerNormalize);
        let matched = dictationMatchWords(expected, dictationTypedTokens(document.getElementById("dictationTyped").value));
        let correct = matched.filter(Boolean).length;
        dictationScoreOnce(sentence, Math.max(0, correct - dictationHintCount), expected.length);
        dictationRenderFeedback(sentence, matched);
        if (correct === expected.length) {
            document.getElementById("dictationTyped").disabled = true;
            dictationComplete(sentence);
        } else {
            dictationAddWrong(sentence, expected.length - correct);
            dictationSetMessage(`${correct} / ${expected.length} kelime doğru. Noktalı yerleri tamamlayıp yeniden kontrol et.`, "error");
        }
        return;
    }

    let slots = dictationSlotElements();
    let allCorrect = true;
    let wrongCount = 0;
    let firstTryCorrect = 0;
    for (let index = 0; index < sentence.holes.length; index++) {
        if (dictationLocked[index]) continue;
        let slot = slots[index];
        let correct = dictationAnswerNormalize(slot.value) === dictationAnswerNormalize(sentence.holes[index].word);
        slot.classList.toggle("correct", correct);
        slot.classList.toggle("wrong", !correct);
        if (correct) {
            slot.disabled = true;
            dictationLocked[index] = true;
            if (!dictationHinted[index]) firstTryCorrect++;
        } else {
            allCorrect = false;
            wrongCount++;
        }
    }
    dictationScoreOnce(sentence, firstTryCorrect, sentence.holes.length);
    dictationAddWrong(sentence, wrongCount);
    if (allCorrect && Object.keys(dictationLocked).length === sentence.holes.length) {
        dictationComplete(sentence);
    } else {
        dictationSetMessage("Kırmızı boşlukları düzeltip yeniden kontrol et.", "error");
    }
}

function dictationHint() {
    if (!dictationStarted || !dictationSentences.length || dictationCompleted) return;
    let sentence = dictationSentences[dictationIndex];

    if (dictationMode === "arrange") {
        // Doğru dizilen baştaki kısım kalır, sıradaki doğru kelime eklenir
        let prefix = dictationArrangePrefix(sentence);
        if (prefix >= sentence.words.length) return;
        dictationOrder = dictationOrder.slice(0, prefix);
        let wanted = dictationAnswerNormalize(sentence.words[prefix]);
        let next = sentence.words.findIndex((word, index) => !dictationOrder.includes(index) && dictationAnswerNormalize(word) === wanted);
        dictationOrder.push(next);
        dictationHintCount++;
        dictationRefreshArrange();
        dictationSetMessage("İpucu: sıradaki kelime yerleştirildi.");
        return;
    }

    if (dictationMode === "sentence") {
        // Doğru yazılan baştaki kelimeler kalır, sıradaki kelime eklenir
        let input = document.getElementById("dictationTyped");
        let expected = sentence.words.map(dictationAnswerNormalize);
        let typed = dictationTypedTokens(input.value);
        let prefix = 0;
        while (prefix < typed.length && prefix < expected.length && typed[prefix] === expected[prefix]) prefix++;
        if (prefix >= expected.length) return;
        input.value = sentence.words.slice(0, prefix + 1).join(" ") + " ";
        dictationHintCount++;
        input.focus();
        dictationSetMessage("İpucu: sıradaki kelime eklendi.");
        return;
    }

    let slots = dictationSlotElements();
    let index = dictationFocusedSlot;
    if (index < 0 || dictationLocked[index]) {
        index = slots.findIndex((slot, slotIndex) => !dictationLocked[slotIndex]);
    }
    if (index < 0) return;
    let expected = dictationAnswerNormalize(sentence.holes[index].word);
    let current = dictationAnswerNormalize(slots[index].value);
    let nextLength = Math.min(current.length + 1, expected.length);
    slots[index].value = expected.slice(0, nextLength);
    slots[index].classList.remove("wrong");
    dictationAnswers[index] = slots[index].value;
    dictationHinted[index] = true;
    if (dictationAssignments[index] !== undefined) {
        delete dictationAssignments[index];  // çip yerine ipucu yazıldı, çip bankaya döner
        dictationRefreshBank();
    }
    slots[index].focus();
    dictationFocusedSlot = index;
    dictationSetMessage("İpucu eklendi.");
}

function dictationReveal() {
    if (!dictationStarted || !dictationSentences.length) return;
    let sentence = dictationSentences[dictationIndex];
    dictationRevealed = true;
    // Hiç kontrol edilmeden cevabı gösterilen cümle: kelimeler toplama eklenir, doğruya eklenmez
    let total = dictationMode === "fill" ? sentence.holes.length : sentence.words.length;
    dictationScoreOnce(sentence, 0, total);

    if (dictationMode === "arrange") {
        dictationOrder = sentence.words.map((word, index) => index);
        dictationCompleted = true;
        dictationRefreshArrange(sentence.words.map(() => "shown"));
    } else if (dictationMode === "sentence") {
        document.getElementById("dictationTyped").disabled = true;
        let feedback = document.getElementById("dictationFeedback");
        feedback.replaceChildren();
        let shown = document.createElement("span");
        shown.className = "feedback-shown";
        shown.textContent = sentence.line.text;
        feedback.appendChild(shown);
    } else {
        let slots = dictationSlotElements();
        for (let index = 0; index < sentence.holes.length; index++) {
            slots[index].value = sentence.holes[index].word;
            slots[index].disabled = true;
            slots[index].classList.remove("wrong");
            slots[index].classList.add("shown");
            dictationLocked[index] = true;
        }
    }
    dictationMarkDone(sentence);
    // Cevap gösterilince otomatik geçilmez: kullanıcı doğrusunu okuyabilsin
    dictationSetMessage("Cevap gösterildi. Hazır olunca Sonraki ile devam et.");
    document.getElementById("dictationNext").focus();
}

function dictationCancelAdvance() {
    if (dictationAdvanceTimer !== null) {
        clearTimeout(dictationAdvanceTimer);
        dictationAdvanceTimer = null;
    }
}

function dictationFinish() {
    let percent = dictationWordTotal ? Math.round(dictationCorrectTotal / dictationWordTotal * 100) : 0;
    dictationSetMessage(`Dikte tamamlandı! İlk denemede doğru: ${dictationCorrectTotal} / ${dictationWordTotal} kelime (%${percent}). Baştan başla ile yeniden deneyebilirsin.`, "success");
}

// Yeni cümleye geçince yazmaya hemen başlanabilsin
function dictationFocusAnswer() {
    if (!dictationStarted) return;
    let target = dictationMode === "sentence"
        ? document.getElementById("dictationTyped")
        : dictationSlotElements().find((item) => !item.disabled);
    if (target) target.focus({ preventScroll: true });
}

function dictationNext() {
    if (!dictationSentences.length) return;
    if (dictationIndex < dictationSentences.length - 1) {
        dictationIndex++;
        dictationRender();
        dictationPlayCurrent();
        dictationFocusAnswer();
    } else {
        dictationFinish();
    }
}

function dictationPrevious() {
    if (dictationIndex > 0) {
        dictationIndex--;
        dictationRender();
        dictationPlayCurrent();
        dictationFocusAnswer();
    }
}

function dictationRestart() {
    if (!dictationVideoId) return;
    dictationIndex = 0;
    dictationCorrectTotal = 0;
    dictationWordTotal = 0;
    dictationScored = {};
    dictationDoneLines = {};
    try { localStorage.removeItem(dictationStorageKey("progress")); } catch (error) { }
    dictationRender();
    dictationPlayCurrent();
    dictationFocusAnswer();
}


// ===== Oynatma =====

// Ekrandaki cümlenin sesinin bittiği an: video.js'teki shadowBoundary (altyazı bitişi + pay + "Sonda +").
// Altyazı sesten erken bittiği için tam altyazı bitişinde durulmaz; yoksa cümlenin sonu kesilir.
function dictationBoundary(sentence) {
    return shadowBoundary(sentence.lineIndex);
}

// "Sonda +" değişti (video.js setTail çağırır): cümle sonunda duruyorsak eklenen süre hemen çalınsın
function dictationTailChanged() {
    if (document.getElementById("dictation").hidden) return;
    if (!dictationSentences.length || !dictationPlayerReady() || !dictationPausedAtEnd) return;
    if (player.getCurrentTime() < dictationBoundary(dictationSentences[dictationIndex]) - 0.1) {
        dictationPausedAtEnd = false;
        dictationLoopAt = 0;
        dictationSeekGuard = Date.now() + 300;
        player.playVideo();
    }
}

function dictationPlayerReady() {
    return typeof player !== "undefined" && player && typeof player.getPlayerState === "function";
}

function dictationPlayCurrent() {
    if (!dictationSentences.length || !dictationPlayerReady()) return;
    let line = dictationSentences[dictationIndex].line;
    if (typeof player.setPlaybackRate === "function") player.setPlaybackRate(dictationSpeed);
    dictationPausedAtEnd = false;
    dictationLoopAt = 0;
    dictationSeekGuard = Date.now() + 600;
    player.seekTo(line.start, true);
    player.playVideo();
}

// Dikte açıkken oynatma ekrandaki cümleye kilitli: hangi yolla oynatılırsa oynatılsın
// (Dinle, YouTube'un kendi düğmesi, klavye) cümle bitince durur.
function dictationWatch() {
    if (document.getElementById("dictation").hidden || !dictationSentences.length || !dictationPlayerReady()) return;
    // Otomatik tekrar: cümle sonunda durduktan kısa süre sonra, çözülmediyse yeniden çal
    if (dictationLoopAt && Date.now() >= dictationLoopAt) {
        dictationLoopAt = 0;
        if (dictationLoop && dictationStarted && !dictationCompleted && dictationPausedAtEnd) {
            dictationPlayCurrent();
            return;
        }
    }
    if (Date.now() < dictationSeekGuard || player.getPlayerState() !== 1) return;  // 1 = oynuyor
    let sentence = dictationSentences[dictationIndex];
    let end = dictationBoundary(sentence);
    let now = player.getCurrentTime();
    if (dictationPausedAtEnd || now < sentence.line.start - 1 || now > end + 1.5) {
        // Sonda durduktan sonra yeniden oynatıldı ya da başka yere atlandı: ekrandaki cümleyi baştan çal
        dictationPlayCurrent();
        return;
    }
    if (now >= end - 0.08) {
        player.pauseVideo();
        dictationPausedAtEnd = true;
        if (dictationLoop && dictationStarted && !dictationCompleted) {
            dictationLoopAt = Date.now() + 1200;  // kısa bir nefes payı, sonra yeniden
        }
    }
}
setInterval(dictationWatch, 100);


// ===== Çip sürükleme (Boşluk türü) =====

function dictationStartDrag(event, chip) {
    if (dictationMode !== "fill") return;  // Sırala'da çiplere yalnızca dokunulur
    if (event.button !== undefined && event.button !== 0) return;
    dictationDraggedChip = Number(chip.dataset.chip);
    dictationWasDragged = false;
    dictationDragStart = { x: event.clientX, y: event.clientY };
    event.preventDefault();
}

function dictationMoveDrag(event) {
    if (dictationDraggedChip === null) return;
    if (!dictationDragPreview) {
        // 6 pikselden az hareket dokunma/tıklama sayılır
        if (Math.hypot(event.clientX - dictationDragStart.x, event.clientY - dictationDragStart.y) < 6) return;
        let chip = document.querySelector(`#dictationBank .dictation-chip[data-chip="${dictationDraggedChip}"]`);
        dictationDragPreview = document.createElement("span");
        dictationDragPreview.className = "dictation-drag-preview";
        dictationDragPreview.textContent = chip ? chip.textContent : "";
        document.body.appendChild(dictationDragPreview);
    }
    dictationWasDragged = true;
    dictationDragPreview.style.left = `${event.clientX + 12}px`;
    dictationDragPreview.style.top = `${event.clientY + 12}px`;
    document.querySelectorAll(".dictation-slot.drop-target").forEach((slot) => slot.classList.remove("drop-target"));
    let target = document.elementFromPoint(event.clientX, event.clientY);
    if (target && target.matches(".dictation-slot:not(:disabled)")) target.classList.add("drop-target");
}

function dictationEndDrag(event) {
    if (dictationDraggedChip === null) return;
    let target = dictationWasDragged ? document.elementFromPoint(event.clientX, event.clientY) : null;
    if (target && target.matches(".dictation-slot:not(:disabled)")) {
        let index = dictationSlotElements().indexOf(target);
        dictationPlaceChip(dictationDraggedChip, index);
    }
    if (dictationDragPreview) dictationDragPreview.remove();
    dictationDragPreview = null;
    dictationDraggedChip = null;
    document.querySelectorAll(".dictation-slot.drop-target").forEach((slot) => slot.classList.remove("drop-target"));
    setTimeout(function () { dictationWasDragged = false; }, 0);
}


// ===== Başlangıç: düğmeleri bağla =====

dictationLoadPreferences();
dictationRenderChoices();
document.querySelectorAll("#dictationDifficulty button").forEach(function (button) {
    button.addEventListener("click", function () { dictationChoose("difficulty", button.dataset.value); });
});
document.querySelectorAll("#dictationModeSelect button").forEach(function (button) {
    button.addEventListener("click", function () { dictationChoose("mode", button.dataset.value); });
});
document.getElementById("dictationStart").addEventListener("click", dictationStart);
document.getElementById("dictationCheck").addEventListener("click", dictationCheck);
document.getElementById("dictationHint").addEventListener("click", dictationHint);
document.getElementById("dictationReveal").addEventListener("click", dictationReveal);
document.getElementById("dictationNext").addEventListener("click", dictationNext);
document.getElementById("dictationPrevious").addEventListener("click", dictationPrevious);
document.getElementById("dictationRestart").addEventListener("click", dictationRestart);
document.getElementById("dictationListen").addEventListener("click", dictationPlayCurrent);
document.getElementById("dictationSpeed").addEventListener("change", function () {
    dictationSpeed = Number(this.value) || 1;
    if (player && typeof player.setPlaybackRate === "function") player.setPlaybackRate(dictationSpeed);
});
try { dictationLoop = localStorage.getItem("dictation:loop") === "true"; } catch (error) { }
document.getElementById("dictationLoop").checked = dictationLoop;
document.getElementById("dictationLoop").addEventListener("change", function () {
    dictationLoop = this.checked;
    dictationLoopAt = 0;
    try { localStorage.setItem("dictation:loop", String(dictationLoop)); } catch (error) { }
    // Cümle sonunda dururken açıldıysa hemen yeniden çal
    if (dictationLoop && dictationStarted && !dictationCompleted && dictationPausedAtEnd) dictationPlayCurrent();
});
document.getElementById("dictationGear").addEventListener("click", function () {
    dictationSetChoicesOpen(!dictationChoicesOpen);
});
// Çevir: ekrandaki cümlenin Türkçesi (video.js fetchTranslation). Otomatik geçiş bekliyorsa durur ki okunabilsin.
document.getElementById("dictationTranslate").addEventListener("click", function () {
    if (!dictationStarted || !dictationSentences.length) return;
    dictationCancelAdvance();
    let shownIndex = dictationIndex;
    let box = document.getElementById("dictationTranslation");
    box.hidden = false;
    box.className = "dictation-translation";
    box.textContent = "Çevriliyor…";
    fetchTranslation(dictationSentences[dictationIndex].line.text)
        .then(function (translation) {
            if (shownIndex === dictationIndex) box.textContent = translation;
        })
        .catch(function (error) {
            box.textContent = error.name === "TypeError" ? "Sunucuya ulaşılamadı." : error.message;
            box.className = "dictation-translation error";
        });
});
document.getElementById("dictationBank").addEventListener("pointerdown", function (event) {
    let chip = event.target.closest(".dictation-chip");
    if (chip) dictationStartDrag(event, chip);
});
window.addEventListener("pointermove", dictationMoveDrag);
window.addEventListener("pointerup", dictationEndDrag);
document.getElementById("dictation").addEventListener("keydown", function (event) {
    if ((event.ctrlKey && event.code === "Space") || (event.altKey && event.key.toLowerCase() === "r")) {
        event.preventDefault();
        dictationPlayCurrent();
    }
});

dictationReset();
