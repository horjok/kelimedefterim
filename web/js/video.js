// ===== YouTube videosu (ya da Spotify şarkısı) + transkript + IPA telaffuz =====
// Transkripti yerel sunucu (server.py) getirir: /api/transcript?url=...
// Şarkıda sözler /api/song?url=<spotify linki> ile gelir, aynı biçimdedir; oynatıcı spotify-player.js'teki SpotifyPlayer.

let player = null;          // açık oynatıcı: YT.Player ya da şarkıda SpotifyPlayer (ikisi de aynı yöntemler)
let youtubePlayer = null;   // YouTube oynatıcısı bir kez kurulur; şarkıdan dönünce yeniden kullanılır
let playerTimersStarted = false;  // followVideo / shadowTick zamanlayıcıları yalnızca bir kez kurulur
let transcriptRequest = 0;  // geç gelen eski bir yanıt yeni videonun / şarkının üstüne yazmasın

// ----- Şarkı durumu -----
let songMode = false;       // açık olan bir Spotify şarkısı mı
let songSynced = true;      // şarkıda satır takibi çalışıyor mu (Spotify girişi yoksa 30 sn önizleme: false)
let songPending = false;    // yeni şarkının oynatıcısı kuruldu ama sözleri henüz ekrandakilerin yerine geçmedi
let songPlayer = null;      // açık şarkının SpotifyPlayer'ı (player şarkıda bunu gösterir)
let songParked = null;      // söz seçimi beklenirken önceki şarkının oynatıcısı gizli bekler ("Vazgeç" geri getirir)
let songData = null;        // açık şarkının yanıtı (başlık, kapak, lrclibId)
let songLink = "";          // açık şarkının linki ("Başka söz seç" için)
let songLinkedStart = 0;    // video.html?v=sp:<id>&t=<sn> ile gelindiyse şarkının bekleyeceği saniye
let songLinkedTrack = "";   // o adresteki şarkının Spotify kimliği (başka şarkı açılırsa songLinkedStart atılır)
const SONG_PREVIEW_MAX = 35;  // oynatıcının bildirdiği süre bundan kısaysa girişsiz önizleme sayılır (sn)
const SONG_PREVIEW_NOTE = "Tam şarkı ve satır takibi için tarayıcıda Spotify'a giriş yap; şu an 30 saniyelik önizleme çalıyor.";
const SONG_NO_PLAYER_NOTE = "Spotify oynatıcısı yüklenemedi; sözler, kelimeler ve dikte metni yine çalışır. Sözler: LRCLIB";
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
        localStorage.setItem(langKey("lastVideoUrl"), url);
    } catch (error) {
        // Gizli pencerede localStorage kapalı olabilir; önemli değil
    }
}

function loadLastUrl() {
    try {
        return localStorage.getItem(langKey("lastVideoUrl")) || "";
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

function startPlayerTimers() {
    if (playerTimersStarted) {
        return;
    }
    playerTimersStarted = true;
    setInterval(followVideo, 250);
    setInterval(shadowTick, 100);  // cümle sonunda durdurma için daha sık bakılır
}

async function showVideo(videoId) {
    await youtubeReady;
    if (songMode || songPending) {
        return;  // beklerken bir şarkı açıldı ya da açılıyor
    }
    showPlayerKind("youtube");

    if (youtubePlayer === null) {
        youtubePlayer = new YT.Player("player", {
            videoId: videoId,
            // start: kayıtlı kelimeden gelindiyse video o saniyede bekler (aşağıda linkedStart)
            playerVars: { playsinline: 1, rel: 0, origin: location.origin, start: linkedStart },
            events: {
                onReady: function () {
                    startPlayerTimers();
                    applyShadowSpeed();
                },
                onStateChange: function () {
                    updateShadowBar();  // Oynat/Duraklat yazısı hemen değişsin
                }
            }
        });
        player = youtubePlayer;
    } else {
        player = youtubePlayer;
        player.cueVideoById(videoId);
    }
}

// Oynatıcı alanında YouTube kutusu mu, Spotify kutusu mu görünsün.
// YouTube'a dönülünce Spotify oynatıcısı kapatılır; şarkıya geçilince YouTube videosu duraklatılır.
function showPlayerKind(kind) {
    let isSong = kind === "song";
    if (isSong) {
        if (youtubePlayer !== null && typeof youtubePlayer.pauseVideo === "function") {
            youtubePlayer.pauseVideo();
        }
    } else {
        if (songPlayer !== null) {
            songPlayer.destroy();
            songPlayer = null;
        }
        if (songParked !== null) {
            songParked.destroy();
            songParked = null;
        }
        songPending = false;
        player = youtubePlayer;
        hideSongChoices();
    }
    let youtubeBox = document.getElementById("playerBox");
    let songBox = document.getElementById("songBox");
    if (youtubeBox) youtubeBox.hidden = isSong;
    if (songBox) songBox.hidden = !isSong;
}

// Şarkı açık ama Spotify girişi yok: 30 sn önizleme, satır takibi kapalı
function songPreview() {
    return songMode && !songSynced;
}

// Satır takibi, cümleyi çalma ve dikte kilidi çalışabilir mi (dictation.js de bakar)
function playbackAllowed() {
    return !songPending && !songPreview();
}

// Önizlemede satıra ya da kelimeye dokununca: oynatma yok, giriş notu dikkat çeksin
function flashSongNote() {
    let note = document.getElementById("songNote");
    if (!note || !songMode) {
        return;
    }
    note.classList.remove("attention");
    void note.offsetWidth;  // sınıf yeniden eklenince vurgu yeniden başlasın
    note.classList.add("attention");
}

function seekTo(seconds) {
    if (player === null || typeof player.seekTo !== "function") {
        return;
    }
    if (!playbackAllowed()) {
        flashSongNote();
        return;
    }
    player.seekTo(seconds, true);
    player.playVideo();
}

// keepRepeats: aynı cümlenin sıradaki tekrarı çalınıyorsa tekrar sayacı sıfırlanmaz
function playFrom(index, keepRepeats) {
    if (!playbackAllowed()) {
        // Şarkı önizlemesi: satır yalnızca cümle kartına alınır (çeviri, kayıt, sondan başa çalışır), çalınmaz
        if (songPreview() && lines[index]) {
            shadowCurrent = index;
            renderShadowCard();
            flashSongNote();
        }
        return;
    }
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
    if (lines.length === 0 || !playerReady() || !playbackAllowed()) {
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
    let response = await fetch(apiUrl(`/api/translate?text=${encodeURIComponent(text)}`));
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
    if (!shadowActive() || lines.length === 0 || !playerReady() || !playbackAllowed()) {
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
    } else if (event.key === " " && !target.closest("button") && playbackAllowed()) {
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
    if (!MODES.includes(name) || (name === "grammar" && !langHas("grammar"))) {
        name = "lines";
    }
    let previousMode = currentMode;
    currentMode = name;
    document.getElementById("videoLayout").dataset.mode = name;  // CSS yerleşimi buna göre değişir
    let wasShadow = previousMode === "lines" || previousMode === "grammar";
    document.getElementById("shadowBar").hidden = !shadowActive() || songPreview();
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

// Seçili dilde video gramer analizi yoksa (İspanyolca, şimdilik) Gramer modu gizlenir
document.getElementById("modeGrammar").hidden = !langHas("grammar");

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
    if (songMode && songData !== null) {
        return songData.title || "";  // "Sanatçı – Şarkı" (oynatıcı yüklenemese de)
    }
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
    let groups = [...Object.keys(vocab.levels)];
    if (langHas("phrasal")) groups.push("phrasal");  // İspanyolcada phrasal verb yok
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

    fetch(apiUrl(`/api/vocab?url=${encodeURIComponent(url)}`))
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
                let phrasalText = langHas("phrasal") ? `, ${vocab.phrasal.length} phrasal verb` : "";
                let tapText = !songMode ? " Karta dokununca video kelimenin ilk geçtiği yere gider."
                    : songSynced ? " Karta dokununca şarkı kelimenin ilk geçtiği yerden çalar." : "";
                status.textContent = `${total} öğrenmeye değer kelime${phrasalText}. ` +
                    `${basicCount} çok yaygın kelime "Temel" grubuna ayrıldı.${tapText}`;
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

// Ağ ya da sunucu hatasını kullanıcıya gösterilecek cümleye çevirir
function requestErrorMessage(error) {
    if (error.name === "TypeError" || error.name === "SyntaxError") {
        return "Sunucuya ulaşılamadı. Terminalde \"python server.py\" çalışıyor mu? Sayfayı http://localhost:8000 adresinden aç.";
    }
    return error.message;
}

async function fetchJson(url) {
    let response = await fetch(url);
    let data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `Sunucu hatası (kod ${response.status}).`);
    }
    return data;
}

// YouTube videosu da şarkı da gelen transkripti aynı yoldan ekrana koyar
function applyTranscript(data, url) {
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
    saveLastUrl(url);
    loadVocab(url);
}

function loadTranscript(url) {
    let button = document.getElementById("videoButton");

    if (url === "") {
        setStatus("Önce bir YouTube ya da Spotify şarkı linki yapıştır.", "error");
        return;
    }

    let request = ++transcriptRequest;
    button.disabled = true;
    if (typeof dictationReset === "function") {
        dictationReset();
    }
    setStatus("Transkript getiriliyor...", "");

    fetchJson(apiUrl(`/api/transcript?url=${encodeURIComponent(url)}`))
        .then(function (data) {
            if (request !== transcriptRequest) {
                return;  // bu arada başka bir link gönderildi
            }
            if (data.lines.length === 0) {
                throw new Error("Transkript boş geldi.");
            }
            songMode = false;
            songSynced = true;
            songData = null;
            songLink = "";
            showPlayerKind("youtube");  // açık bir şarkı varsa oynatıcısı hemen kapanır
            applyTranscript(data, url);
            showVideo(data.videoId);
            applySongUi();

            let kind = data.generated ? "otomatik altyazı" : "el ile yazılmış altyazı";
            setStatus(`${lines.length} satır yüklendi (${kind}).`, "ok");
        })
        .catch(function (error) {
            if (request !== transcriptRequest) {
                return;
            }
            setStatus(requestErrorMessage(error), "error");
            console.error("Transkript hatası:", error);
        })
        .finally(function () {
            if (request === transcriptRequest) {
                button.disabled = false;
            }
        });
}


// ===== Şarkı: Spotify linki → LRCLIB sözleri + Spotify gömülü oynatıcısı =====

function formatDuration(seconds) {
    return seconds > 0 ? formatTime(Math.round(seconds)) : "";
}

function hideSongChoices() {
    let box = document.getElementById("songChoices");
    if (box) {
        box.hidden = true;
        box.replaceChildren();
    }
}

// Birden çok söz bulununca: "Sanatçı · Albüm · m:ss" düğmeleri; seçilen &lyrics=<id> ile istenir.
// replacing: "Başka söz seç" ile açıldı (seçim açık şarkının sözlerinin yerine geçer)
function renderSongChoices(data, url, replacing) {
    let box = document.getElementById("songChoices");
    if (!box) {
        return;
    }
    box.replaceChildren();
    let head = document.createElement("p");
    head.className = "song-choices-head";
    head.textContent = replacing
        ? "Hangi sözler doğru? Seçtiğin sürüm öncekinin yerine geçer."
        : `“${data.title || "Bu şarkı"}” için birden çok söz bulundu. Şarkıya uyanı seç:`;
    box.appendChild(head);

    let list = document.createElement("div");
    list.className = "song-choice-list";
    for (let candidate of data.candidates || []) {
        let choice = document.createElement("button");
        choice.type = "button";
        choice.className = "song-choice";
        let parts = [candidate.artist, candidate.album, formatDuration(Number(candidate.duration) || 0)].filter(Boolean);
        let label = document.createElement("span");
        label.className = "song-choice-label";
        label.textContent = parts.join(" · ") || candidate.track || `Söz #${candidate.id}`;
        choice.appendChild(label);
        if (candidate.track) {
            choice.title = candidate.track;
        }
        if (replacing && songData && candidate.id === songData.lrclibId) {
            choice.setAttribute("aria-current", "true");
            let current = document.createElement("span");
            current.className = "song-choice-current";
            current.textContent = "şu anki";
            choice.appendChild(current);
        }
        choice.addEventListener("click", function () {
            loadSong(url, candidate.id);
        });
        list.appendChild(choice);
    }
    box.appendChild(list);

    let cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "mini";
    cancel.textContent = "Vazgeç";
    cancel.addEventListener("click", cancelSongChoice);
    box.appendChild(cancel);

    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Başlıkta kapak + "Sanatçı – Şarkı"
function renderSongHeader(title, thumbnail) {
    let titleBox = document.getElementById("songTitle");
    if (titleBox) {
        titleBox.textContent = title || "";
        titleBox.parentElement.hidden = !title;  // başlık yokken boş satır yer kaplamasın
    }
    let cover = document.getElementById("songCover");
    if (cover) {
        let ok = typeof thumbnail === "string" && thumbnail.startsWith("https://");
        cover.hidden = !ok;
        if (ok) {
            cover.src = thumbnail;
        } else {
            cover.removeAttribute("src");
        }
    }
}

// Önizleme mi (girişsiz 30 sn), tam şarkı mı: süre bilinmiyorsa eşzamanlı sayılır.
// Oynatıcı hiç yüklenemediyse oynatma yok: önizleme gibi davranılır.
function songIsSynced() {
    if (songPlayer === null) {
        return false;
    }
    let length = songPlayer.duration();
    let lastStart = lines.length ? lines[lines.length - 1].start : 0;
    return length === 0 || length > SONG_PREVIEW_MAX || lastStart < 30;
}

// songMode / songSynced değişince: şarkıya özgü düğmeler, notlar, hız seçimleri ve dikte oynatması
function applySongUi() {
    let preview = songPreview();
    // Spotify oynatıcısında hız ayarı yok: şarkıda hız seçimleri gizlenir
    for (let id of ["shadowSpeed", "dictationSpeed"]) {
        let select = document.getElementById(id);
        let label = select ? select.closest("label") : null;
        if (label) {
            label.hidden = songMode;
        }
    }
    let bar = document.getElementById("shadowBar");
    if (bar) {
        bar.hidden = !shadowActive() || preview;
    }
    let note = document.getElementById("songNote");
    if (note) {
        note.textContent = !songMode ? ""
            : songPlayer === null ? SONG_NO_PLAYER_NOTE
            : preview ? SONG_PREVIEW_NOTE : "Sözler: LRCLIB";
        note.classList.toggle("preview", preview);
        note.classList.remove("attention");
    }
    let other = document.getElementById("songOtherLyrics");
    if (other) {
        other.hidden = !songMode;
    }
    let hint = document.getElementById("linesHint");
    if (hint) {
        hint.textContent = !songMode ? "Bir cümleye dokun, video oradan oynasın."
            : preview ? "Satır takibi kapalı: sözleri oku, satıra dokununca cümle kartına gelir."
            : "Bir satıra dokun, şarkı oradan çalsın.";
    }
    if (preview) {
        shadowWaitUntil = 0;
        highlight(-1);
    }
    if (typeof dictationSetPlayback === "function") {
        dictationSetPlayback(!preview);
    }
}

// Spotify oynatıcısının süresi sonradan öğrenildiyse (ya da değiştiyse) önizleme kararı yenilenir
function songDurationKnown() {
    if (!songMode || player !== songPlayer || songPlayer === null) {
        return;
    }
    let synced = songIsSynced();
    if (synced !== songSynced) {
        songSynced = synced;
        applySongUi();
    }
}

// Spotify'dan oynatma durumu geldi: Oynat/Duraklat yazısı; önizleme bittiyse giriş notu dikkat çeker
function songPlayerChanged() {
    updateShadowBar();
    if (songPreview() && songPlayer !== null && songPlayer.paused && songPlayer.length > 0
        && songPlayer.position >= songPlayer.length - 1) {
        flashSongNote();
    }
}

// Yeni Spotify oynatıcısı "player" olur; eski oynatıcı kapanır.
// choosing: söz seçimi bekleniyor (şarkı henüz açılmadı).
// parkOld: eski oynatıcı açık şarkınınsa seçim bitene kadar gizli saklanır ("Vazgeç" onu geri getirir).
function commitSongPlayer(fresh, choosing, parkOld) {
    let old = songPlayer !== null && songPlayer !== fresh ? songPlayer : null;  // fresh null olabilir
    if (old !== null) {
        if (parkOld) {
            if (songParked !== null && songParked !== old) {
                songParked.destroy();
            }
            old.pauseVideo();
            old.box.hidden = true;
            songParked = old;
        } else {
            old.destroy();
        }
    }
    if (!choosing && songParked !== null) {  // şarkı açıldı: saklanan eski oynatıcıya gerek kalmadı
        if (songParked !== fresh) {
            songParked.destroy();
        }
        songParked = null;
    }
    if (fresh !== null) {
        fresh.box.hidden = false;
        fresh.onChange = songPlayerChanged;
        fresh.onDuration = songDurationKnown;
    }
    songPlayer = fresh;  // null: oynatıcı yüklenemedi, şarkı oynatıcısız açılır
    player = fresh;
    startPlayerTimers();
}

// Söz seçim listesinde "Vazgeç": yeni şarkı açılmadıysa önceki oynatıcı (şarkı ya da YouTube) geri gelir
function cancelSongChoice() {
    hideSongChoices();
    setStatus("", "");
    dropPendingSong();
}

// Bekleyen (sözü seçilmemiş) şarkıdan vazgeçilir: oynatıcısı kapanır, ekrandaki içeriğin oynatıcısı geri gelir.
// "Vazgeç" ve loadSong'un hata yolu kullanır (liste kapandıysa sayfa bekleyen durumda takılı kalmasın).
function dropPendingSong() {
    if (!songPending) {
        return;  // bekleyen şarkı yok ("Başka söz seç" listesi): açık şarkı aynen kalır
    }
    if (songParked !== null || songMode) {
        // Ekranda açık bir şarkı var: onun oynatıcısı geri gelir (oynatıcısı hiç yüklenemediyse null)
        if (songPlayer !== null) {
            songPlayer.destroy();
        }
        songPlayer = songParked;
        songParked = null;
        if (songPlayer !== null) {
            songPlayer.box.hidden = false;
        }
        player = songPlayer;
        songPending = false;
        if (songData !== null) {
            renderSongHeader(songData.title, songData.thumbnail);
        }
    } else {
        showPlayerKind("youtube");  // şarkı oynatıcısı kapanır, YouTube kutusu geri gelir
        if (lines.length === 0) {
            document.getElementById("videoLayout").hidden = true;
        }
    }
}

function applySong(data, url, fresh) {
    commitSongPlayer(fresh, false, false);
    showPlayerKind("song");
    songMode = true;
    songPending = false;
    songData = data;
    songLink = url;
    if (fresh !== null) {
        fresh.title = data.title || "";
    }
    hideSongChoices();
    if (typeof dictationReset === "function") {
        dictationReset();
    }
    applyTranscript(data, url);
    songSynced = songIsSynced();
    renderSongHeader(data.title, data.thumbnail);
    applySongUi();

    let message = `${lines.length} satır yüklendi (şarkı sözü).`;
    setStatus(message, "ok");
    if (data.languageWarning) {
        let warning = document.createElement("span");
        warning.className = "status-warn";
        warning.textContent = `Bu şarkı ${langName()} görünmüyor; çalışılan dili kontrol et.`;
        document.getElementById("videoResult").append(" ", warning);
    }
    if (songLinkedStart > 0) {
        if (songSynced && fresh !== null) {
            fresh.seekTo(songLinkedStart);  // kayıtlı kelimeden gelindi: o saniyede bekler
        }
        if (lines.length) {
            // Oynatma başlamadan cümle kartı o saniyedeki cümlede dursun (yoksa ilk satırda kalır)
            shadowCurrent = lineIndexAt(songLinkedStart);
            highlight(shadowCurrent);
            renderShadowCard();
        }
        songLinkedStart = 0;
    }
}

// lyricsId: aday listesinden seçilen LRCLIB kaydı (yoksa sunucu kendisi seçer ya da liste döndürür)
async function loadSong(url, lyricsId) {
    let request = ++transcriptRequest;
    let button = document.getElementById("videoButton");
    let trackId = typeof spotifyTrackId === "function" ? spotifyTrackId(url) : null;
    if (trackId !== songLinkedTrack) {
        songLinkedStart = 0;  // adresteki saniye yalnızca adresteki şarkı için geçerli
    }
    hideSongChoices();
    if (!trackId) {
        setStatus("Yalnızca tek bir şarkının linkini yapıştır.", "error");
        return;
    }

    let layout = document.getElementById("videoLayout");
    // Hata olursa geri dönülecek görünüm
    let previous = {
        song: songPlayer,
        songMode: songMode,
        pending: songPending,
        layoutHidden: layout.hidden
    };
    let reused = songPlayer !== null && !songPlayer.destroyed && songPlayer.trackId === trackId;
    let fresh = reused ? songPlayer : null;
    button.disabled = true;

    try {
        if (!reused) {
            setStatus("Spotify oynatıcısı hazırlanıyor...", "");
            songPending = true;  // ekrandaki eski satırlar yeni oynatıcıya göre takip edilmesin
            layout.hidden = false;  // gömülü oynatıcı görünür bir yerde kurulmalı
            if (previous.song !== null) {
                previous.song.pauseVideo();
                previous.song.box.hidden = true;  // eski şarkı, yenisi açılana kadar gizli bekler
            }
            showPlayerKind("song");
            renderSongHeader("", "");
            try {
                fresh = await createSpotifyPlayer("spotifyPlayer", trackId);
            } catch (playerError) {
                // Oynatıcı yüklenemedi (ağ, engelleyici eklenti): sözler, kelimeler ve dikte metni yine açılır
                console.warn("Spotify oynatıcısı:", playerError);
                fresh = null;
            }
            if (request !== transcriptRequest) {
                if (fresh !== null && fresh !== songPlayer) fresh.destroy();
                return;
            }
        }

        let query = `/api/song?url=${encodeURIComponent(url)}`;
        if (lyricsId) {
            query += `&lyrics=${encodeURIComponent(lyricsId)}`;
        } else {
            // Süre, sözlerin kendiliğinden seçilmesine yardım eder; önizlemede (≈30 sn) gönderilmez
            // Gömülü oynatıcı ilk oynatmadan önce süre göndermez: başlamamışsa beklemeden bilinen süre (yoksa 0) kullanılır
            let length = fresh === null ? 0 : (fresh.started ? await fresh.waitDuration(3000) : fresh.length);
            if (request !== transcriptRequest) {
                if (fresh !== null && fresh !== songPlayer) fresh.destroy();
                return;
            }
            if (length > SONG_PREVIEW_MAX) {
                query += `&duration=${Math.round(length * 10) / 10}`;
            }
        }
        setStatus("Şarkı sözleri getiriliyor...", "");
        let data = await fetchJson(apiUrl(query));
        if (request !== transcriptRequest) {
            if (fresh !== null && fresh !== songPlayer) fresh.destroy();
            return;
        }

        if (data.choose) {
            // Kullanıcı seçene kadar oynatıcı yeni şarkıda kalır (dinleyip karşılaştırabilsin)
            let sameSong = songMode && songData !== null && songData.videoId === `sp:${trackId}`;
            commitSongPlayer(fresh, true, previous.songMode && !previous.pending);
            songPending = !sameSong;
            renderSongHeader(data.title, data.thumbnail);
            renderSongChoices(data, url, false);
            setStatus("Bu şarkı için birden çok söz bulundu. Aşağıdan doğru olanı seç.", "");
            return;
        }
        if (!Array.isArray(data.lines) || data.lines.length === 0) {
            throw new Error("Şarkı sözleri boş geldi.");
        }
        applySong(data, url, fresh);
    } catch (error) {
        if (request !== transcriptRequest) {
            return;
        }
        songLinkedStart = 0;
        if (!reused) {
            // Yeni oynatıcı kapanır, önceki görünüm geri gelir
            if (fresh !== null && fresh !== songPlayer) {
                fresh.destroy();
            }
            if (previous.song !== null && !previous.song.destroyed) {
                previous.song.box.hidden = false;
            }
            showPlayerKind(previous.songMode || previous.pending ? "song" : "youtube");
            songPending = previous.pending;
            if (songData !== null) {
                renderSongHeader(songData.title, songData.thumbnail);
            }
            layout.hidden = previous.layoutHidden;
        }
        // Liste başta kapandı: bekleyen bir söz seçimi varsa ondan vazgeçilir, önceki video ya da şarkı oynatılabilir kalır
        dropPendingSong();
        setStatus(requestErrorMessage(error), "error");
        console.error("Şarkı hatası:", error);
    } finally {
        if (request === transcriptRequest) {
            button.disabled = false;
        }
    }
}

// "Başka söz seç": açık şarkı için aday listesi (choose=1 önbelleği atlar, tek aday olsa da liste döner)
async function songOtherLyrics() {
    if (!songMode || !songLink) {
        return;
    }
    let request = transcriptRequest;
    let url = songLink;
    let button = document.getElementById("songOtherLyrics");
    button.disabled = true;
    setStatus("Başka sözler aranıyor...", "");
    try {
        let data = await fetchJson(apiUrl(`/api/song?url=${encodeURIComponent(url)}&choose=1`));
        if (request !== transcriptRequest) {
            return;
        }
        if (!data.choose) {
            // Sunucu liste yerine tek şarkı döndürdüyse onu tek aday olarak göster
            data = { title: data.title, candidates: [{ id: data.lrclibId, artist: data.artist, track: data.track }] };
        }
        renderSongChoices(data, url, true);
        setStatus("Listeden şarkıya uyan sözleri seç.", "");
    } catch (error) {
        if (request === transcriptRequest) {
            setStatus(requestErrorMessage(error), "error");
        }
    } finally {
        button.disabled = false;
    }
}

document.getElementById("songOtherLyrics").addEventListener("click", songOtherLyrics);

document.getElementById("videoForm").addEventListener("submit", function (event) {
    event.preventDefault();  // form sayfayı yenilemesin
    let url = document.getElementById("videoUrl").value.trim();
    if (typeof isSpotifyLink === "function" && isSpotifyLink(url)) {
        loadSong(url);
    } else {
        loadTranscript(url);
    }
});

document.getElementById("videoUrl").value = loadLastUrl();

// Kartlar / Kelimeler / Kitaplık sayfasından gelen bağlantı: video.html?v=<id>&t=<saniye>
// Video kendiliğinden yüklenir ve kelimenin geçtiği saniyede bekler. Şarkıda id "sp:<spotify id>".
let linkedStart = 0;
{
    let params = new URLSearchParams(location.search);
    let linkedVideo = params.get("v") || "";
    if (/^[A-Za-z0-9_-]{11}$/.test(linkedVideo)) {
        linkedStart = Math.max(0, Math.floor(Number(params.get("t")) || 0));
        let url = `https://www.youtube.com/watch?v=${linkedVideo}`;
        document.getElementById("videoUrl").value = url;
        loadTranscript(url);
    } else if (/^sp:[A-Za-z0-9]{22}$/.test(linkedVideo)) {
        songLinkedStart = Math.max(0, Math.floor(Number(params.get("t")) || 0));
        songLinkedTrack = linkedVideo.slice(3);
        let url = `https://open.spotify.com/track/${linkedVideo.slice(3)}`;
        document.getElementById("videoUrl").value = url;
        loadSong(url);
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
