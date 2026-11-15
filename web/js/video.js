// ===== YouTube videosu + transkript + IPA telaffuz =====
// Transkripti yerel sunucu (server.py) getirir: /api/transcript?url=...

let player = null;
let lines = [];          // sunucudan gelen cümleler
let lineElements = [];   // ekrandaki cümle satırları
let activeIndex = -1;
let lastUserScroll = 0;  // kullanıcı kendisi kaydırınca otomatik kaydırma bir süre durur

// YouTube IFrame API hazır olunca kendisi onYouTubeIframeAPIReady'yi çağırır.
// Bunu bir Promise'e çeviriyoruz: "API hazır olunca devam et".
let youtubeReady = new Promise(function (resolve) {
    window.onYouTubeIframeAPIReady = resolve;
});


// ===== Yardımcılar =====

function formatTime(seconds) {
    let minutes = Math.floor(seconds / 60);
    let rest = Math.floor(seconds % 60);
    return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function setStatus(message, className) {
    let result = document.getElementById("videoResult");
    result.textContent = message;
    result.className = className;
}

function saveLastUrl(url) {
    try {
        localStorage.setItem("lastVideoUrl", url);
    } catch (error) {
        // Gizli pencerede localStorage kapalı olabilir; önemli değil
    }
}

function loadLastUrl() {
    try {
        return localStorage.getItem("lastVideoUrl") || "";
    } catch (error) {
        return "";
    }
}


// ===== Transkripti ekrana çizme =====

function wordHtml(word) {
    let box = document.createElement("span");
    box.className = "w";

    let text = document.createElement("span");
    text.className = "w-text";
    text.textContent = word.text;

    let ipa = document.createElement("span");
    ipa.className = "w-ipa";
    ipa.textContent = word.ipa ? `/${word.ipa}/` : "";

    box.append(text, ipa);
    return box;
}

function renderLines() {
    let container = document.getElementById("lines");
    container.innerHTML = "";
    lineElements = [];
    activeIndex = -1;
    shadowCurrent = -1;
    shadowEnded = false;
    shadowWaitUntil = 0;
    shadowRepeatLeft = shadowRepeat;
    shadowCardIndex = -2;
    updateShadowBar();

    lines.forEach(function (line, index) {
        let row = document.createElement("button");
        row.type = "button";
        row.className = "line";
        row.addEventListener("click", function () {
            playFrom(index);
        });

        let time = document.createElement("span");
        time.className = "line-time";
        time.textContent = formatTime(line.start);

        let words = document.createElement("span");
        words.className = "line-words";
        for (let word of line.words) {
            words.appendChild(wordHtml(word));
        }

        row.append(time, words);
        container.appendChild(row);
        lineElements.push(row);
    });
}


// ===== Video oynatıcı =====

async function showVideo(videoId) {
    await youtubeReady;

    if (player === null) {
        player = new YT.Player("player", {
            videoId: videoId,
            // start: kayıtlı kelimeden gelindiyse video o saniyede bekler (aşağıda linkedStart)
            playerVars: { playsinline: 1, rel: 0, origin: location.origin, start: linkedStart },
            events: {
                onReady: function () {
                    setInterval(followVideo, 250);
                    setInterval(shadowTick, 100);  // cümle sonunda durdurma için daha sık bakılır
                    applyShadowSpeed();
                },
                onStateChange: function () {
                    updateShadowBar();  // Oynat/Duraklat yazısı hemen değişsin
                }
            }
        });
    } else {
        player.cueVideoById(videoId);
    }
}

function seekTo(seconds) {
    if (player === null || typeof player.seekTo !== "function") {
        return;
    }
    player.seekTo(seconds, true);
    player.playVideo();
}

// keepRepeats: aynı cümlenin sıradaki tekrarı çalınıyorsa tekrar sayacı sıfırlanmaz
function playFrom(index, keepRepeats) {
    lastUserScroll = 0;  // tıklayınca otomatik takip hemen geri gelsin
    shadowCurrent = index;
    shadowEnded = false;
    shadowWaitUntil = 0;
    if (!keepRepeats) {
        shadowRepeatLeft = shadowRepeat;
    }
    shadowSeekGuard = Date.now() + 600;
    seekTo(lines[index].start);
    highlight(index);
}

// Videonun o anki saniyesine göre hangi cümlede olduğumuzu bul
function findLineAt(seconds) {
    let found = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].start <= seconds + 0.15) {
            found = i;
        } else {
            break;
        }
    }
    return found;
}

function followVideo() {
    if (lines.length === 0 || typeof player.getCurrentTime !== "function") {
        return;
    }
    let index = findLineAt(player.getCurrentTime());
    if (index !== activeIndex) {
        highlight(index);
    }
}


// ===== Shadowing: cümle cümle dinle, dur, tekrar et =====

let currentMode = "lines";  // setMode günceller

// Shadowing (cümle sonunda durma, çubuk, cümle kartı) Transkript ve Gramer modlarında çalışır
function shadowActive() {
    return currentMode === "lines" || currentMode === "grammar";
}
let shadowCurrent = -1;     // çalınan ya da az önce biten cümle
let shadowEnded = false;    // shadowCurrent'in sonunda durduk mu?
let shadowSeekGuard = 0;    // atladıktan hemen sonra oynatıcı bir an eski zamanı bildirebilir; o arada karar verme
let shadowRepeat = 1;       // her cümle kaç kez çalınsın (×1, ×2, ×3, ×5, ×10)
let shadowRepeatLeft = 1;   // bu cümlenin kalan çalınma sayısı (şu anki dahil)
let shadowGap = "manual";   // cümle sonunda: "off" durma | "manual" dur | sayı: cümle süresinin o katı kadar bekle
let shadowWaitUntil = 0;    // otomatik bekleme bitiş anı (Date.now() cinsinden); 0 = beklemiyor

// Önden bakmadan: başlangıcı geçilmiş son cümle (findLineAt 0.15 sn önden bakar, burada istemiyoruz)
function lineIndexAt(seconds) {
    let found = 0;
    for (let i = 0; i < lines.length && lines[i].start <= seconds; i++) {
        found = i;
    }
    return found;
}

// Cümlenin sesinin bittiği an (tahmin). Altyazı saatleri yazının ekranda kaldığı süredir, konuşmanın değil:
// yazı çoğu zaman ses bitmeden kaybolur ve sıradaki satır erken gelir. Tam altyazı bitişinde durursak
// cümlenin son kelimeleri kesilir. Bu yüzden sona biraz pay eklenir.
const TAIL_PAD = 0.8;      // art arda gelen satırlarda sıradaki satırın içine taşma payı (sn)
const TAIL_MAX = 1.5;      // arada boşluk varsa altyazı bitişinden sonra en çok bu kadar beklenir (sn)
const TAIL_OVERLAP = 0.3;  // otomatik altyazıda satırlar üst üste biner: sıradaki başlayınca neredeyse hemen biter

let tailExtra = 0;         // "Sonda +": kullanıcının eklediği süre (sn); shadowing ve dikte ortak kullanır

function shadowBoundary(index) {
    let line = lines[index];
    let next = lines[index + 1];
    if (!next) {
        return line.end + TAIL_MAX + tailExtra;
    }
    if (next.start < line.end) {
        return next.start + TAIL_OVERLAP + tailExtra;
    }
    return Math.min(line.end + TAIL_MAX, next.start + TAIL_PAD) + tailExtra;
}

// "Sonda +" seçimi iki çubukta da var (.tail-select); biri değişince öbürü de güncellenir
function setTail(seconds) {
    tailExtra = [0, 1, 2, 3].includes(seconds) ? seconds : 0;
    try { localStorage.setItem("tailExtra", String(tailExtra)); } catch (error) { }
    document.querySelectorAll(".tail-select").forEach(function (select) {
        select.value = String(tailExtra);
    });
    // Cümle sonunda duruyorsak eklenen süre hemen çalınsın
    if (shadowActive() && shadowEnded && playerReady() && shadowCurrent >= 0
        && player.getCurrentTime() < shadowBoundary(shadowCurrent) - 0.1) {
        shadowEnded = false;
        shadowSeekGuard = Date.now() + 300;
        player.playVideo();
    }
    if (typeof dictationTailChanged === "function") {
        dictationTailChanged();
    }
}

// Bir cümlenin Türkçe çevirisi (sunucu: /api/translate). Aynı cümle ikinci kez sorulmaz.
let translationCache = new Map();

async function fetchTranslation(text) {
    if (translationCache.has(text)) {
        return translationCache.get(text);
    }
    let response = await fetch(`/api/translate?text=${encodeURIComponent(text)}`);
    let data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `Sunucu hatası (kod ${response.status}).`);
    }
    translationCache.set(text, data.tr);
    return data.tr;
}

function playerReady() {
    return player !== null && typeof player.getCurrentTime === "function";
}

function isPlaying() {
    return playerReady() && player.getPlayerState() === 1;  // 1 = YT.PlayerState.PLAYING
}

function shadowGo(index) {
    if (lines.length === 0) {
        return;
    }
    playFrom(Math.max(0, Math.min(lines.length - 1, index)));
    updateShadowBar();
}

function shadowTogglePlay() {
    if (!playerReady()) {
        return;
    }
    if (shadowWaitUntil) {
        // Otomatik bekleme sırasında basıldı: beklemeyi iptal et, elle durmuş gibi kal
        shadowWaitUntil = 0;
        shadowEnded = true;
        updateShadowBar();
        return;
    }
    if (isPlaying()) {
        player.pauseVideo();
    } else {
        player.playVideo();  // cümle sonunda durduysak shadowTick sıradakine geçer
    }
}

// Cümle bitti ve devam etme zamanı geldi: kalan tekrar varsa aynı cümle, yoksa sonraki
function shadowAdvance() {
    if (shadowRepeatLeft > 1) {
        shadowRepeatLeft--;
        playFrom(shadowCurrent, true);
    } else if (shadowCurrent < lines.length - 1) {
        playFrom(shadowCurrent + 1);
    } else {
        shadowEnded = false;
        shadowWaitUntil = 0;
        player.pauseVideo();  // son cümle de bitti
    }
}

function shadowTick() {
    if (!shadowActive() || lines.length === 0 || !playerReady()) {
        return;
    }
    if (Date.now() < shadowSeekGuard) {
        updateShadowBar();
        return;
    }

    // Otomatik bekleme: süre dolunca (ya da kullanıcı YouTube'dan oynatınca) sıradakine geç
    if (shadowWaitUntil) {
        if (isPlaying() || Date.now() >= shadowWaitUntil) {
            shadowWaitUntil = 0;
            shadowAdvance();
        }
        updateShadowBar();
        return;
    }

    let now = player.getCurrentTime();

    // Kullanıcı videoda başka yere atladıysa (YouTube çubuğu vb.) bulunduğu cümleyi yeniden belirle
    if (shadowCurrent < 0 || now < lines[shadowCurrent].start - 0.5 || now > shadowBoundary(shadowCurrent) + 1) {
        shadowCurrent = lineIndexAt(now);
        shadowEnded = false;
        shadowRepeatLeft = shadowRepeat;
    }

    if (isPlaying()) {
        if (shadowEnded) {
            // Cümle sonunda durmuştuk, kullanıcı devam ettirdi
            shadowAdvance();
        } else if (now >= shadowBoundary(shadowCurrent) - 0.08) {
            if (shadowGap === "off") {
                if (shadowRepeatLeft > 1) {
                    shadowAdvance();  // durmadan aynı cümleyi yeniden çal
                } else {
                    let next = lineIndexAt(now);  // video akmaya devam eder
                    if (next !== shadowCurrent) {
                        shadowCurrent = next;
                        shadowRepeatLeft = shadowRepeat;
                    }
                }
            } else if (shadowGap === "manual") {
                player.pauseVideo();
                shadowEnded = true;
            } else {
                // Senin tekrar etmen için bekle: cümlenin (hıza göre) süresinin shadowGap katı kadar
                let rate = Number(document.getElementById("shadowSpeed").value) || 1;
                let duration = (shadowBoundary(shadowCurrent) - lines[shadowCurrent].start) / rate;
                player.pauseVideo();
                shadowWaitUntil = Date.now() + Math.max(800, duration * shadowGap * 1000);
            }
        }
    }
    updateShadowBar();
}

function updateShadowBar() {
    let current = Math.max(0, shadowCurrent);
    let counter = lines.length ? `Cümle ${current + 1} / ${lines.length}` : "Cümle – / –";
    if (lines.length && shadowRepeat > 1) {
        counter += ` · tekrar ${shadowRepeat - shadowRepeatLeft + 1}/${shadowRepeat}`;
    }
    document.getElementById("shadowCounter").textContent = counter;
    document.getElementById("shadowPrev").disabled = current <= 0;
    document.getElementById("shadowNext").disabled = current >= lines.length - 1;
    document.getElementById("shadowPlay").textContent = shadowWaitUntil
        ? "❚❚ Sıra sende…"
        : (isPlaying() ? "❚❚ Duraklat" : "▶ Oynat");
    renderShadowCard();
}

function applyShadowSpeed() {
    if (playerReady() && typeof player.setPlaybackRate === "function") {
        player.setPlaybackRate(Number(document.getElementById("shadowSpeed").value) || 1);
    }
}

document.getElementById("shadowPrev").addEventListener("click", function () { shadowGo(Math.max(0, shadowCurrent) - 1); });
document.getElementById("shadowNext").addEventListener("click", function () { shadowGo(Math.max(0, shadowCurrent) + 1); });
document.getElementById("shadowReplay").addEventListener("click", function () { shadowGo(Math.max(0, shadowCurrent)); });
document.getElementById("shadowPlay").addEventListener("click", shadowTogglePlay);
document.getElementById("shadowSpeed").addEventListener("change", function () {
    applyShadowSpeed();
    try { localStorage.setItem("shadowSpeed", this.value); } catch (error) { }
});
document.getElementById("shadowRepeat").addEventListener("change", function () {
    shadowRepeat = Number(this.value) || 1;
    shadowRepeatLeft = shadowRepeat;
    try { localStorage.setItem("shadowRepeat", this.value); } catch (error) { }
    updateShadowBar();
});
document.getElementById("shadowGap").addEventListener("change", function () {
    shadowGap = (this.value === "off" || this.value === "manual") ? this.value : (Number(this.value) || "manual");
    shadowEnded = false;
    shadowWaitUntil = 0;
    try { localStorage.setItem("shadowGap", this.value); } catch (error) { }
});
document.querySelectorAll(".tail-select").forEach(function (select) {
    select.addEventListener("change", function () { setTail(Number(select.value) || 0); });
});

// Ayarları hatırla
try {
    let speedSelect = document.getElementById("shadowSpeed");
    let savedSpeed = localStorage.getItem("shadowSpeed");
    if (savedSpeed !== null && [...speedSelect.options].some((option) => option.value === savedSpeed)) {
        speedSelect.value = savedSpeed;
    }
    let repeatSelect = document.getElementById("shadowRepeat");
    let savedRepeat = localStorage.getItem("shadowRepeat");
    if (savedRepeat !== null && [...repeatSelect.options].some((option) => option.value === savedRepeat)) {
        repeatSelect.value = savedRepeat;
        shadowRepeat = Number(savedRepeat);
        shadowRepeatLeft = shadowRepeat;
    }
    let gapSelect = document.getElementById("shadowGap");
    let savedGap = localStorage.getItem("shadowGap");
    if (savedGap === null && localStorage.getItem("shadowPause") === "false") {
        savedGap = "off";  // eski "Cümle sonunda dur" kutusu kapalıydı
    }
    if (savedGap !== null && [...gapSelect.options].some((option) => option.value === savedGap)) {
        gapSelect.value = savedGap;
        shadowGap = (savedGap === "off" || savedGap === "manual") ? savedGap : Number(savedGap);
    }
    let savedTail = Number(localStorage.getItem("tailExtra") || localStorage.getItem("dictation:tail"));
    if ([1, 2, 3].includes(savedTail)) {
        tailExtra = savedTail;
    }
    document.querySelectorAll(".tail-select").forEach(function (select) {
        select.value = String(tailExtra);
    });
} catch (error) { }


// ===== Cümle kartı: çalışılan cümle büyük yazıyla, IPA, çeviri ve ses kaydı =====

let shadowCardIndex = -2;        // kartta şu an hangi cümle var (yeniden çizmeyi önler)
let basicForms = new Set();      // çok yaygın kelimeler: kartta soluk yazılır, diğerleri kalın

function renderShadowCard(force) {
    let card = document.getElementById("shadowCard");
    let index = lines.length ? Math.max(0, shadowCurrent) : -1;
    if (!force && index === shadowCardIndex) {
        return;
    }
    shadowCardIndex = index;
    if (typeof buildupClose === "function") {
        buildupClose();  // cümle değişti: sondan başa alıştırması kapanır
    }
    let sentence = document.getElementById("shadowSentence");
    sentence.innerHTML = "";
    document.getElementById("shadowTranslation").hidden = true;
    if (index < 0) {
        return;
    }
    let showIpa = document.getElementById("shadowIpa").checked;
    for (let word of lines[index].words) {
        let box = document.createElement("span");
        box.className = "w";
        let text = document.createElement("span");
        let plain = word.text.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
        text.className = basicForms.has(plain) || !word.ipa ? "w-text soft" : "w-text";
        text.textContent = word.text;
        box.appendChild(text);
        if (showIpa) {
            let ipa = document.createElement("span");
            ipa.className = "w-ipa";
            ipa.textContent = word.ipa ? `/${word.ipa}/` : "";
            box.appendChild(ipa);
        }
        sentence.appendChild(box);
    }
}

// Kelime listesi gelince: "Temel" gruptaki kelimeler kartta soluk gösterilir
function setBasicForms(vocabData) {
    basicForms = new Set();
    for (let item of (vocabData && vocabData.basic) || []) {
        for (let form of (Array.isArray(item.forms) ? item.forms : [item.word])) {
            basicForms.add(String(form).toLowerCase());
        }
    }
    renderShadowCard(true);
}

document.getElementById("shadowIpa").addEventListener("change", function () {
    try { localStorage.setItem("shadowIpa", String(this.checked)); } catch (error) { }
    renderShadowCard(true);
});
try {
    if (localStorage.getItem("shadowIpa") === "false") {
        document.getElementById("shadowIpa").checked = false;
    }
} catch (error) { }

document.getElementById("shadowTranslate").addEventListener("click", function () {
    if (lines.length === 0) {
        return;
    }
    let index = Math.max(0, shadowCurrent);
    let box = document.getElementById("shadowTranslation");
    box.hidden = false;
    box.className = "shadow-translation";
    box.textContent = "Çevriliyor…";
    fetchTranslation(lines[index].text)
        .then(function (translation) {
            if (index === Math.max(0, shadowCurrent)) {  // bu arada cümle değişmediyse
                box.textContent = translation;
            }
        })
        .catch(function (error) {
            box.textContent = error.name === "TypeError" ? "Sunucuya ulaşılamadı." : error.message;
            box.className = "shadow-translation error";
        });
});


// ----- Kendi sesini kaydet ve dinle (MediaRecorder; kayıt yalnızca tarayıcıda kalır) -----

let voiceRecorder = null;    // kayıt sürerken MediaRecorder
let voiceChunks = [];
let voiceUrl = "";           // son kaydın adresi (blob:)
let voiceAudio = null;

function setRecordNote(text, isError) {
    let note = document.getElementById("shadowRecordNote");
    note.textContent = text;
    note.className = isError ? "shadow-record-note error" : "shadow-record-note";
}

async function toggleRecording() {
    let button = document.getElementById("shadowRecord");
    if (voiceRecorder !== null) {
        voiceRecorder.stop();  // onstop kaydı hazırlar
        return;
    }
    if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") {
        setRecordNote("Bu tarayıcı ses kaydını desteklemiyor.", true);
        return;
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
        setRecordNote("Mikrofona erişilemedi. Tarayıcının adres çubuğundan mikrofon iznini ver.", true);
        return;
    }
    if (isPlaying()) {
        player.pauseVideo();  // video sesi kayda karışmasın
    }
    voiceChunks = [];
    voiceRecorder = new MediaRecorder(stream);
    voiceRecorder.addEventListener("dataavailable", function (event) {
        if (event.data.size > 0) {
            voiceChunks.push(event.data);
        }
    });
    voiceRecorder.addEventListener("stop", function () {
        stream.getTracks().forEach((track) => track.stop());  // mikrofonu bırak
        if (voiceUrl) {
            URL.revokeObjectURL(voiceUrl);
        }
        voiceUrl = URL.createObjectURL(new Blob(voiceChunks, { type: voiceRecorder.mimeType }));
        voiceRecorder = null;
        button.textContent = "● Kendini kaydet";
        button.setAttribute("aria-pressed", "false");
        document.getElementById("shadowPlayback").disabled = false;
        setRecordNote("Kayıt hazır. \"Kaydımı dinle\" ile dinle, \"Tekrar\" ile asıl cümleyle karşılaştır.");
    });
    voiceRecorder.start();
    button.textContent = "■ Kaydı bitir";
    button.setAttribute("aria-pressed", "true");
    setRecordNote("Kaydediliyor… Cümleyi söyle, bitince \"Kaydı bitir\"e bas.");
}

document.getElementById("shadowRecord").addEventListener("click", toggleRecording);
document.getElementById("shadowPlayback").addEventListener("click", function () {
    if (!voiceUrl) {
        return;
    }
    if (isPlaying()) {
        player.pauseVideo();
    }
    if (voiceAudio) {
        voiceAudio.pause();
    }
    voiceAudio = new Audio(voiceUrl);
    voiceAudio.play();
});


// ===== Notlarım: videoya özel, tarayıcıda saklanır =====

let notesVideoId = "";
let notesTimer = null;

function loadNotes(videoId) {
    notesVideoId = videoId;
    let text = "";
    try { text = localStorage.getItem(`notes:${videoId}`) || ""; } catch (error) { }
    document.getElementById("notesText").value = text;
    document.getElementById("notesState").textContent = text ? "· kayıtlı" : "";
}

document.getElementById("notesText").addEventListener("input", function () {
    let text = this.value;
    document.getElementById("notesState").textContent = "· yazılıyor…";
    clearTimeout(notesTimer);
    notesTimer = setTimeout(function () {  // her tuşta değil, yazma durunca kaydet
        if (!notesVideoId) {
            return;
        }
        try {
            if (text.trim() === "") {
                localStorage.removeItem(`notes:${notesVideoId}`);
            } else {
                localStorage.setItem(`notes:${notesVideoId}`, text);
            }
            document.getElementById("notesState").textContent = text.trim() ? "· kaydedildi" : "";
        } catch (error) {
            document.getElementById("notesState").textContent = "· kaydedilemedi";
        }
    }, 500);
});

// Klavye kısayolları (yalnızca Transkript modunda, yazı alanında değilken)
document.addEventListener("keydown", function (event) {
    if (!shadowActive() || lines.length === 0 || event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }
    let target = event.target;
    if (target.closest("input, textarea, select") || target.isContentEditable) {
        return;
    }
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        shadowGo(Math.max(0, shadowCurrent) - 1);
    } else if (event.key === "ArrowRight") {
        event.preventDefault();
        shadowGo(Math.max(0, shadowCurrent) + 1);
    } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        shadowGo(Math.max(0, shadowCurrent));
    } else if (event.key === " " && !target.closest("button")) {
        event.preventDefault();  // sayfa kaymasın
        shadowTogglePlay();
    }
});

function highlight(index) {
    if (activeIndex >= 0 && lineElements[activeIndex]) {
        lineElements[activeIndex].classList.remove("active");
    }
    activeIndex = index;
    if (index < 0) {
        return;
    }
    lineElements[index].classList.add("active");

    let linesVisible = !document.getElementById("linesView").hidden;
    if (linesVisible && Date.now() - lastUserScroll > 4000) {
        scrollToLine(lineElements[index]);
    }
}

function scrollToLine(row) {
    let box = document.getElementById("transcript");
    let boxScrolls = box.scrollHeight > box.clientHeight + 1;

    if (boxScrolls) {
        // Geniş ekran: sadece transkript kutusu kayar
        box.scrollTo({ top: row.offsetTop - box.clientHeight / 3, behavior: "smooth" });
    } else {
        // Telefon: sayfa kayar; video üstte sabit durduğu için onun altına hizala
        let videoHeight = document.querySelector(".player-wrap").offsetHeight;  // video + shadowing çubuğu
        let top = row.getBoundingClientRect().top + window.scrollY - videoHeight - 24;
        window.scrollTo({ top: top, behavior: "smooth" });
    }
}

function noteUserScroll() {
    lastUserScroll = Date.now();
}
["wheel", "touchmove"].forEach(function (eventName) {
    window.addEventListener(eventName, noteUserScroll, { passive: true });
});


// ===== Çalışma modları: Transkript | Dikte | Kelimeler =====

const MODES = ["lines", "dictation", "vocab", "grammar"];

function setMode(name, scroll) {
    if (!MODES.includes(name)) {
        name = "lines";
    }
    let previousMode = currentMode;
    currentMode = name;
    document.getElementById("videoLayout").dataset.mode = name;  // CSS yerleşimi buna göre değişir
    let wasShadow = previousMode === "lines" || previousMode === "grammar";
    document.getElementById("shadowBar").hidden = !shadowActive();
    document.getElementById("shadowCard").hidden = !shadowActive();
    document.getElementById("grammarView").hidden = name !== "grammar";
    if (name === "grammar" && typeof grammarOpen === "function") {
        grammarOpen();  // ilk açılışta gramer konularını yükler
    }
    if (!shadowActive()) {
        shadowWaitUntil = 0;  // başka moda geçildi: otomatik bekleme iptal
    }
    if (shadowActive() && !wasShadow) {
        applyShadowSpeed();  // dikte kendi hızını kullanmış olabilir
    }
    // Dikte açıkken transkript panelinde gerçek cümleler yerine noktalı (maskeli) liste görünür
    document.getElementById("dictation").hidden = name !== "dictation";
    document.getElementById("dictationBar").hidden = name !== "dictation";
    document.getElementById("maskView").hidden = name !== "dictation";
    document.getElementById("linesView").hidden = name !== "lines";
    document.getElementById("vocabView").hidden = name !== "vocab";
    document.querySelectorAll(".mode").forEach(function (button) {
        button.setAttribute("aria-selected", button.dataset.mode === name);
    });
    document.getElementById("transcript").scrollTop = 0;
    try { localStorage.setItem("videoMode", name); } catch (error) { }

    if (name === "lines" && activeIndex >= 0) {
        scrollToLine(lineElements[activeIndex]);
    }
    if (name === "dictation") fitDictation();
    // Dikteye geçince video ve dikte paneli birlikte görünsün
    if (scroll && name === "dictation") {
        if (window.innerWidth >= 960) {
            document.querySelector(".modes").scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
            // Telefon: video üstte yapışık; paneli tam onun altına getir
            let videoHeight = document.querySelector(".player-wrap").offsetHeight;
            let top = document.getElementById("dictation").getBoundingClientRect().top + window.scrollY - videoHeight - 8;
            window.scrollTo({ top: top, behavior: "smooth" });
        }
    }
}

document.querySelectorAll(".mode").forEach(function (button) {
    button.addEventListener("click", function () { setMode(button.dataset.mode, true); });
});

// Son kullanılan mod hatırlansın
let savedMode = "lines";
try { savedMode = localStorage.getItem("videoMode") || "lines"; } catch (error) { }
setMode(savedMode);


// ===== Kelime listesi: seviyelere göre + phrasal verb'ler =====

let vocab = null;           // sunucudan gelen { levels: {A1: [...]}, phrasal: [...] }
let selectedGroup = "A1";   // seçili seviye ya da "phrasal"
let vocabRequest = 0;       // eski videonun cevabı yeni videonun üstüne yazılmasın

function groupItems(group) {
    if (group === "phrasal") return vocab.phrasal;
    if (group === "basic") return vocab.basic || [];  // çok yaygın kelimeler (you, get, think...)
    return vocab.levels[group];
}

// ----- Kelimeyi kartlara / kelime listesine kaydetme (store.js) -----

let currentVideoId = "";  // loadTranscript doldurur; kayıtlı kelime hangi videodan geldiğini bilsin

function videoTitle() {
    try {
        return player.getVideoData().title || "";
    } catch (error) {
        return "";  // oynatıcı henüz hazır değil
    }
}

function savedEntryFrom(item, isPhrasal) {
    let word = isPhrasal ? item.phrase : item.word;
    // Kelimenin geçtiği cümle: kartta örnek olarak gösterilir ve oradan dinlenir
    let lineIndex = lines.length ? lineIndexAt(item.start + 0.05) : -1;
    let line = lineIndex >= 0 ? lines[lineIndex] : null;
    return {
        clipStart: line ? line.start : item.start,
        clipEnd: line ? shadowBoundary(lineIndex) : item.start + 6,
        key: savedKey(isPhrasal ? "phrasal" : "word", word),
        kind: isPhrasal ? "phrasal" : "word",
        word: word,
        tr: item.tr || "",
        ipa: item.ipa || "",
        pos: isPhrasal ? "phrasal verb" : (item.pos || ""),
        level: isPhrasal ? "" : (item.level || ""),
        example: isPhrasal ? (item.example || "") : (line ? line.text : ""),
        videoId: currentVideoId,
        videoTitle: videoTitle(),
        start: item.start
    };
}

function renderSavedSummary() {
    let box = document.getElementById("savedSummary");
    if (!box || typeof savedAll !== "function") {
        return;
    }
    let all = savedAll();
    let cards = all.filter((entry) => entry.inCards).length;
    let list = all.filter((entry) => entry.inList).length;
    box.innerHTML = `Kayıtlı: <a href="kelimeler.html">defterde <b>${list}</b> kelime</a> · <a href="kartlar.html"><b>${cards}</b> kart</a>`;
}

// target: "inCards" ya da "inList"
function saveButtonHtml(item, isPhrasal, target, label) {
    let button = document.createElement("button");
    button.type = "button";
    let key = savedKey(isPhrasal ? "phrasal" : "word", isPhrasal ? item.phrase : item.word);

    function paint() {
        let saved = savedGet(key);
        let on = saved !== null && saved[target];
        button.setAttribute("aria-pressed", on);
        button.textContent = on ? `✓ ${label}` : `＋ ${label}`;
        button.title = on ? `${label}: kayıtlı (kaldırmak için bas)` : `${label}: kaydet`;
    }
    button.paint = paint;  // komşu düğme de bunu çağırır: "Kart" eklenince "Liste" de işaretlenir

    button.addEventListener("click", function () {
        let saved = savedGet(key);
        let ok = saved !== null && saved[target]
            ? savedRemove(key, target)
            : savedAdd(savedEntryFrom(item, isPhrasal), target);
        if (!ok) {
            button.textContent = "Kaydedilemedi";
            button.title = "Tarayıcı depolaması kapalı ya da dolu.";
            return;
        }
        for (let sibling of button.parentElement.children) {
            sibling.paint();
        }
        renderSavedSummary();
        renderBulkSave(groupItems(selectedGroup), selectedGroup === "phrasal");  // "Hepsini ekle (n)" sayısı güncellensin
    });

    paint();
    return button;
}

function vocabCardHtml(item, isPhrasal) {
    // Dış kutu: üstte videoya götüren düğme, altta kaydetme düğmeleri (düğme içine düğme konamaz)
    let box = document.createElement("div");
    box.className = isPhrasal ? "vocab-item phrasal" : "vocab-item";

    let card = document.createElement("button");
    card.type = "button";
    card.className = "v-main";
    card.title = "Videoda ilk geçtiği yere git";
    card.addEventListener("click", function () {
        seekTo(item.start);
    });

    let head = document.createElement("span");
    head.className = "v-head";
    let word = document.createElement("span");
    word.className = "v-word";
    word.textContent = isPhrasal ? item.phrase : item.word;
    let count = document.createElement("span");
    count.className = "v-count";
    count.textContent = `×${item.count}`;
    head.append(word, count);

    let ipa = document.createElement("span");
    ipa.className = "v-ipa";
    ipa.textContent = item.ipa ? `/${item.ipa}/` : "";

    let meaning = document.createElement("span");
    meaning.className = "v-tr";
    meaning.textContent = item.tr || "—";

    card.append(head, ipa, meaning);

    if (isPhrasal) {
        let example = document.createElement("span");
        example.className = "v-example";
        example.textContent = `“${item.example}”`;
        card.appendChild(example);
    } else if (item.pos) {
        let pos = document.createElement("span");
        pos.className = "v-pos";
        pos.textContent = item.pos;
        card.appendChild(pos);
    }
    box.appendChild(card);

    if (typeof savedAdd === "function") {  // store.js yüklüyse
        let save = document.createElement("div");
        save.className = "v-save";
        save.append(
            saveButtonHtml(item, isPhrasal, "inList", "Defter"),
            saveButtonHtml(item, isPhrasal, "inCards", "Kart")
        );
        box.appendChild(save);
    }
    if (!isPhrasal) {
        // Sözlük sayfasında açar: tanım, Cambridge, videolarda geçtiği yerler ve sondan başa heceleme
        let link = document.createElement("a");
        link.className = "v-dict";
        link.href = `sozluk.html?q=${encodeURIComponent(item.word)}&hece=1`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Sözlük · hecele ↗";
        box.appendChild(link);
    }
    return box;
}

// Seçili gruptaki (A1, B2, Phrasal verbs…) tüm kelimeleri tek tuşla kaydetme.
// Hepsi zaten kayıtlıysa düğme "kaldır"a döner.
function bulkButtonHtml(items, isPhrasal, target, label) {
    let kind = isPhrasal ? "phrasal" : "word";
    let keyOf = (item) => savedKey(kind, isPhrasal ? item.phrase : item.word);
    let isSaved = function (item) {
        let saved = savedGet(keyOf(item));
        return saved !== null && saved[target];
    };
    let missing = items.filter((item) => !isSaved(item));
    let allSaved = missing.length === 0;

    let button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", allSaved);
    button.textContent = allSaved
        ? `✓ Hepsi ${target === "inCards" ? "kartlarda" : "defterde"} · kaldır`
        : `＋ Hepsini ${label} ekle (${missing.length})`;

    button.addEventListener("click", function () {
        let ok = true;
        if (allSaved) {
            for (let item of items) {
                ok = savedRemove(keyOf(item), target) && ok;
            }
        } else {
            for (let item of missing) {
                ok = savedAdd(savedEntryFrom(item, isPhrasal), target) && ok;
            }
        }
        renderVocabList();  // karttaki düğmeler ve bu düğme yeniden boyansın
        renderSavedSummary();
        if (!ok) {
            document.getElementById("bulkSave").textContent = "Kaydedilemedi: tarayıcı depolaması kapalı ya da dolu.";
        }
    });
    return button;
}

function renderBulkSave(items, isPhrasal) {
    let box = document.getElementById("bulkSave");
    if (!box) {
        return;
    }
    box.innerHTML = "";
    if (items.length === 0 || typeof savedAdd !== "function") {
        return;
    }
    box.append(
        bulkButtonHtml(items, isPhrasal, "inList", "deftere"),
        bulkButtonHtml(items, isPhrasal, "inCards", "kartlara")
    );
}

function renderVocabList() {
    let list = document.getElementById("vocabList");
    list.innerHTML = "";
    let isPhrasal = selectedGroup === "phrasal";
    let items = groupItems(selectedGroup);
    renderBulkSave(items, isPhrasal);

    if (items.length === 0) {
        let empty = document.createElement("p");
        empty.className = "transcript-hint";
        empty.textContent = isPhrasal ? "Bu videoda phrasal verb bulunamadı."
            : selectedGroup === "basic" ? "Bu videoda temel kelime yok."
            : "Bu seviyede öğrenmeye değer kelime yok. Çok yaygın kelimeler \"Temel\" grubunda.";
        list.appendChild(empty);
        return;
    }
    for (let item of items) {
        list.appendChild(vocabCardHtml(item, isPhrasal));
    }
}

function renderLevelChips() {
    let chips = document.getElementById("levelChips");
    chips.innerHTML = "";
    let groups = [...Object.keys(vocab.levels), "phrasal"];
    if (vocab.basic) groups.push("basic");
    let labels = { phrasal: "Phrasal verbs", basic: "Temel" };

    for (let group of groups) {
        let chip = document.createElement("button");
        chip.type = "button";
        chip.className = group in labels ? `level-chip ${group}` : "level-chip";
        chip.setAttribute("aria-pressed", group === selectedGroup);
        if (group === "basic") chip.title = "Çok yaygın kelimeler: zaten bildiğin varsayılır, dikteye girmez";
        let label = labels[group] || group;
        chip.innerHTML = `${label} <b>${groupItems(group).length}</b>`;
        chip.addEventListener("click", function () {
            selectedGroup = group;
            try { localStorage.setItem("vocabGroup", group); } catch (error) { }
            renderLevelChips();
            renderVocabList();
            document.getElementById("transcript").scrollTop = 0;
        });
        chips.appendChild(chip);
    }
}

function resetVocab(message) {
    vocab = null;
    if (typeof dictationSetVocab === "function") {
        dictationSetVocab(null);
    }
    document.getElementById("vocabCount").textContent = "";
    document.getElementById("levelChips").innerHTML = "";
    document.getElementById("vocabList").innerHTML = "";
    document.getElementById("bulkSave").innerHTML = "";
    let status = document.getElementById("vocabStatus");
    status.textContent = message;
    status.className = "transcript-hint";
}

function loadVocab(url) {
    let request = ++vocabRequest;
    resetVocab("Kelimeler seviyelere ayrılıyor ve Türkçeye çevriliyor...");

    fetch(`/api/vocab?url=${encodeURIComponent(url)}`)
        .then(function (response) {
            return response.json().then(function (data) {
                if (!response.ok) {
                    throw new Error(data.error || `Sunucu hatası (kod ${response.status}).`);
                }
                return data;
            });
        })
        .then(function (data) {
            if (request !== vocabRequest) {
                return;  // bu arada başka video açıldı
            }
            vocab = data;
            setBasicForms(vocab);
            if (typeof dictationSetVocab === "function") {
                dictationSetVocab(vocab);
            }
            try {
                let saved = localStorage.getItem("vocabGroup");
                if (saved === "phrasal" || saved === "basic" || saved in vocab.levels) {
                    selectedGroup = saved;
                }
            } catch (error) { }
            // Seçili seviye boşsa (temel kelimeler ayrılınca A1 boşalabilir) dolu ilk seviyeye geç
            if (groupItems(selectedGroup).length === 0) {
                let firstFull = Object.keys(vocab.levels).find((level) => vocab.levels[level].length > 0);
                if (firstFull) selectedGroup = firstFull;
            }

            let total = Object.values(vocab.levels).reduce((sum, items) => sum + items.length, 0);
            document.getElementById("vocabCount").textContent = total;

            let status = document.getElementById("vocabStatus");
            if (data.translationError) {
                status.textContent = data.translationError;
                status.className = "transcript-hint error";
            } else {
                let basicCount = (vocab.basic || []).length;
                status.textContent = `${total} öğrenmeye değer kelime, ${vocab.phrasal.length} phrasal verb. ` +
                    `${basicCount} çok yaygın kelime "Temel" grubuna ayrıldı. Karta dokununca video kelimenin ilk geçtiği yere gider.`;
            }
            renderLevelChips();
            renderVocabList();
            renderSavedSummary();
        })
        .catch(function (error) {
            if (request !== vocabRequest) {
                return;
            }
            let status = document.getElementById("vocabStatus");
            status.textContent = `Kelime listesi hazırlanamadı: ${error.message}`;
            status.className = "transcript-hint error";
            console.error("Kelime listesi hatası:", error);
        });
}


// ===== Linki gönderme =====

function loadTranscript(url) {
    let button = document.getElementById("videoButton");

    if (url === "") {
        setStatus("Önce bir YouTube linki yapıştır.", "error");
        return;
    }

    button.disabled = true;
    if (typeof dictationReset === "function") {
        dictationReset();
    }
    setStatus("Transkript getiriliyor...", "");

    fetch(`/api/transcript?url=${encodeURIComponent(url)}`)
        .then(function (response) {
            return response.json().then(function (data) {
                if (!response.ok) {
                    throw new Error(data.error || `Sunucu hatası (kod ${response.status}).`);
                }
                return data;
            });
        })
        .then(function (data) {
            if (data.lines.length === 0) {
                throw new Error("Transkript boş geldi.");
            }
            lines = data.lines;
            currentVideoId = data.videoId;
            loadNotes(data.videoId);
            if (typeof grammarReset === "function") {
                grammarReset(url);
                if (currentMode === "grammar") {
                    grammarOpen();
                }
            }
            if (typeof dictationSetLines === "function") {
                dictationSetLines(lines, data.videoId);
            }
            renderLines();
            document.getElementById("videoLayout").hidden = false;
            document.getElementById("transcript").scrollTop = 0;
            showVideo(data.videoId);
            saveLastUrl(url);
            loadVocab(url);

            let kind = data.generated ? "otomatik altyazı" : "el ile yazılmış altyazı";
            setStatus(`${lines.length} satır yüklendi (${kind}).`, "ok");
        })
        .catch(function (error) {
            let message = error.message;
            if (error.name === "TypeError" || error.name === "SyntaxError") {
                message = "Sunucuya ulaşılamadı. Terminalde \"python server.py\" çalışıyor mu? Sayfayı http://localhost:8000 adresinden aç.";
            }
            setStatus(message, "error");
            console.error("Transkript hatası:", error);
        })
        .finally(function () {
            button.disabled = false;
        });
}

document.getElementById("videoForm").addEventListener("submit", function (event) {
    event.preventDefault();  // form sayfayı yenilemesin
    loadTranscript(document.getElementById("videoUrl").value.trim());
});

document.getElementById("videoUrl").value = loadLastUrl();

// Kartlar / Kelimeler / Kitaplık sayfasından gelen bağlantı: video.html?v=<id>&t=<saniye>
// Video kendiliğinden yüklenir ve kelimenin geçtiği saniyede bekler.
let linkedStart = 0;
{
    let params = new URLSearchParams(location.search);
    let linkedVideo = params.get("v") || "";
    if (/^[A-Za-z0-9_-]{11}$/.test(linkedVideo)) {
        linkedStart = Math.max(0, Math.floor(Number(params.get("t")) || 0));
        let url = `https://www.youtube.com/watch?v=${linkedVideo}`;
        document.getElementById("videoUrl").value = url;
        loadTranscript(url);
    }
}

// Telefon/tablette dikte paneli yapışık video ile alttaki menü arasına sığsın (style.css --dictation-space)
function fitDictation() {
    if (window.innerWidth >= 960) return;
    let wrap = document.querySelector(".player-wrap");
    let nav = document.querySelector(".nav");
    if (!wrap) return;
    let navHeight = nav ? Math.max(0, window.innerHeight - nav.getBoundingClientRect().top) : 0;
    let space = window.innerHeight - wrap.offsetHeight - navHeight - 16;
    document.documentElement.style.setProperty("--dictation-space", Math.max(240, Math.round(space)) + "px");
}
window.addEventListener("resize", fitDictation);
