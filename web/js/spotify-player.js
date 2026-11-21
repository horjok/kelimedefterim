// ===== Spotify gömülü oynatıcısı (iFrame API) =====
// video.js ve dictation.js oynatıcıyı YouTube'un yöntemleriyle kullanır (getCurrentTime, seekTo, playVideo…).
// SpotifyPlayer aynı yöntemleri Spotify'ın EmbedController'ı üzerinden sağlar; böylece şarkı açıkken
// "player" değişkeni bu nesneyi gösterir ve geri kalan kod değişmeden çalışır.
// Spotify'a giriş yapılmamış tarayıcıda yalnızca 30 saniyelik önizleme çalar (duration ≈ 30 sn).

const SPOTIFY_API_URL = "https://open.spotify.com/embed/iframe-api/v1";
const SPOTIFY_HOST = "open.spotify.com";
const SPOTIFY_TRACK_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_INTL = /^intl-[A-Za-z]{2,3}(-[A-Za-z]+)?$/;  // /intl-tr/track/... gibi bölge öneki
const SPOTIFY_SEEK_SETTLE = 2000;   // atladıktan sonra en çok bu kadar (ms) eski konumu bildiren olaylar yok sayılır
const SPOTIFY_READY_WAIT = 8000;    // "ready" olayı gelmezse oynatıcı yine de bu süre sonra kullanılır (ms)

// Kullanıcının yapıştırdığı metni URL olarak ayrıştırır; bozuksa null (sunucudaki songs.parse_url gibi)
function spotifyParseUrl(link) {
    try {
        return new URL(link.includes("://") ? link : "https://" + link);
    } catch (error) {
        return null;
    }
}

// Spotify şarkı linkinden 22 karakterlik kimlik; şarkı linki değilse null (sunucudaki extract_track_id ile aynı kurallar)
function spotifyTrackId(link) {
    link = String(link || "").trim();
    if (link.toLowerCase().startsWith("spotify:track:")) {
        let candidate = link.split(":").slice(2).join(":");
        return SPOTIFY_TRACK_ID.test(candidate) ? candidate : null;
    }
    let parsed = spotifyParseUrl(link);
    if (parsed === null || parsed.hostname.toLowerCase() !== SPOTIFY_HOST) {
        return null;
    }
    let parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length && SPOTIFY_INTL.test(parts[0])) {
        parts = parts.slice(1);
    }
    if (parts.length >= 2 && parts[0] === "track" && SPOTIFY_TRACK_ID.test(parts[1])) {
        return parts[1];
    }
    return null;
}

// Spotify'a ait bir link mi (albüm ya da çalma listesi de olabilir; şarkı mı olduğunu spotifyTrackId ayırır)
function isSpotifyLink(link) {
    link = String(link || "").trim();
    if (link.toLowerCase().startsWith("spotify:")) {
        return true;
    }
    let parsed = spotifyParseUrl(link);
    return parsed !== null && parsed.hostname.toLowerCase() === SPOTIFY_HOST;
}


// ----- iFrame API betiği: yalnızca ilk şarkı açılınca eklenir -----

let spotifyApiPromise = null;

function spotifyLoadApi() {
    if (spotifyApiPromise !== null) {
        return spotifyApiPromise;
    }
    spotifyApiPromise = new Promise(function (resolve, reject) {
        let script = document.createElement("script");
        let timer = setTimeout(function () { fail("Spotify oynatıcısı yüklenemedi (zaman aşımı)."); }, 15000);
        function fail(message) {
            clearTimeout(timer);
            spotifyApiPromise = null;  // sonraki denemede betik yeniden eklensin
            script.remove();
            reject(new Error(message));
        }
        window.onSpotifyIframeApiReady = function (api) {
            clearTimeout(timer);
            resolve(api);
        };
        script.src = SPOTIFY_API_URL;
        script.async = true;
        script.addEventListener("error", function () { fail("Spotify oynatıcısı yüklenemedi. İnternet bağlantını kontrol et."); });
        document.head.appendChild(script);
    });
    return spotifyApiPromise;
}


// ----- Oynatıcı sarmalayıcısı -----

class SpotifyPlayer {
    constructor(controller, box, trackId) {
        this.isSpotify = true;
        this.controller = controller;
        this.box = box;                 // iframe'i taşıyan kutu (gizlemek ve silmek için)
        this.trackId = trackId;
        this.title = "";                // video.js şarkı açılınca yazar (getVideoData)
        this.position = 0;              // son bilinen konum (sn)
        this.stamp = performance.now(); // o konumun ölçüldüğü an
        this.paused = true;
        this.buffering = false;
        this.length = 0;                // şarkı süresi (sn); bilinmiyorsa 0. Girişsiz önizlemede ≈ 30
        this.started = false;           // ilk oynatma yapıldı mı (ilk seferde play(), sonra resume())
        this.seekTarget = null;         // atlanan konum: oturana kadar eski konumu bildiren olaylar yok sayılır
        this.seekAt = 0;
        this.pendingSeek = null;        // oynatma başlamadan istenen konum: ilk çalışta yeniden atlanır
        this.destroyed = false;
        this.durationWaiters = [];
        this.onChange = null;           // video.js: oynatma durumu değişince (Oynat/Duraklat yazısı)
        this.onDuration = null;         // video.js: süre öğrenilince (önizleme mi, tam şarkı mı)
        controller.addListener("playback_update", (event) => this.update(event && event.data));
    }

    update(data) {
        if (!data || this.destroyed) {
            return;
        }
        let length = (Number(data.duration) || 0) / 1000;
        if (length > 0 && Math.abs(length - this.length) > 0.5) {
            this.length = length;
            this.flushDuration();
            if (typeof this.onDuration === "function") this.onDuration(length);
        }
        let position = (Number(data.position) || 0) / 1000;
        let now = performance.now();
        if (!data.isPaused) {
            this.started = true;
            if (this.pendingSeek !== null) {
                // Başlamadan önce istenen konum: play() şarkıyı baştan başlatmış olabilir
                let target = this.pendingSeek;
                this.pendingSeek = null;
                if (Math.abs(position - target) > 1) {
                    this.seekTo(target);
                    return;
                }
            }
        }
        if (this.seekTarget !== null) {
            if (Math.abs(position - this.seekTarget) < 1.5 || now - this.seekAt > SPOTIFY_SEEK_SETTLE) {
                this.seekTarget = null;
            } else {
                return;  // atlama henüz işlenmedi: eski konumu bildiren olay
            }
        }
        this.position = position;
        this.stamp = now;
        this.paused = Boolean(data.isPaused);
        this.buffering = Boolean(data.isBuffering);
        if (typeof this.onChange === "function") this.onChange();
    }

    flushDuration() {
        let waiters = this.durationWaiters;
        this.durationWaiters = [];
        waiters.forEach((resolve) => resolve(this.length));
    }

    // Son olaydaki konum + (çalıyorsa) o andan bu yana geçen süre: playback_update seyrek ya da hiç gelmeyebilir
    getCurrentTime() {
        if (this.paused || this.buffering) {
            return this.position;
        }
        let time = this.position + (performance.now() - this.stamp) / 1000;
        return this.length > 0 ? Math.min(time, this.length) : time;
    }

    seekTo(seconds) {
        if (this.destroyed) return;
        let target = Math.max(0, Number(seconds) || 0);
        if (!this.started) {
            this.pendingSeek = target;
        }
        this.seekTarget = target;
        this.seekAt = performance.now();
        this.position = target;
        this.stamp = performance.now();
        try { this.controller.seek(target); } catch (error) { }
    }

    playVideo() {
        if (this.destroyed) return;
        this.position = this.getCurrentTime();
        this.stamp = performance.now();
        this.paused = false;   // iyimser: gerçek durum ilk olayla düzelir
        this.buffering = false;
        try {
            if (this.started) {
                this.controller.resume();
            } else {
                this.started = true;
                this.controller.play();
            }
        } catch (error) { }
    }

    pauseVideo() {
        if (this.destroyed) return;
        this.position = this.getCurrentTime();
        this.stamp = performance.now();
        this.paused = true;
        try { this.controller.pause(); } catch (error) { }
    }

    // YouTube durumlarıyla aynı sayılar: 1 oynuyor, 2 duraklatıldı, 3 yükleniyor, -1 başlamadı
    getPlayerState() {
        if (this.destroyed || (!this.started && this.paused)) return -1;
        if (this.paused) return 2;
        return this.buffering ? 3 : 1;
    }

    setPlaybackRate() { }   // Spotify oynatıcısında hız ayarı yok
    cueVideoById() { }

    getVideoData() {
        return { title: this.title };
    }

    duration() {
        return this.length;
    }

    // Süre ilk playback_update ile gelir; en çok ms kadar beklenir, gelmezse 0
    waitDuration(ms) {
        if (this.length > 0 || this.destroyed) {
            return Promise.resolve(this.length);
        }
        return new Promise((resolve) => {
            let done = false;
            let finish = (value) => {
                if (!done) {
                    done = true;
                    resolve(value);
                }
            };
            this.durationWaiters.push(finish);
            setTimeout(() => finish(this.length), ms);
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.flushDuration();
        try { this.controller.destroy(); } catch (error) { }
        if (this.box) this.box.remove();
    }
}

// elementId: oynatıcının konacağı kap (#spotifyPlayer). iFrame API verilen öğeyi iframe ile değiştirdiği için
// her oynatıcıya kabın içinde yeni bir kutu açılır; eski oynatıcı ayrıca destroy() ile silinir.
async function createSpotifyPlayer(elementId, trackId) {
    let api = await spotifyLoadApi();
    let container = document.getElementById(elementId);
    if (!container) {
        throw new Error("Spotify oynatıcısının yeri sayfada yok.");
    }
    let box = document.createElement("div");
    box.className = "spotify-embed";
    let target = document.createElement("div");
    box.appendChild(target);
    container.appendChild(box);
    let height = window.innerWidth < 720 ? 80 : 152;  // telefonda kısa oynatıcı: yapışık alan az yer kaplasın

    return new Promise(function (resolve, reject) {
        let timer = setTimeout(function () {
            box.remove();
            reject(new Error("Spotify oynatıcısı yanıt vermedi."));
        }, 15000);
        try {
            api.createController(target, { uri: `spotify:track:${trackId}`, width: "100%", height: height }, function (controller) {
                clearTimeout(timer);
                let wrapper = new SpotifyPlayer(controller, box, trackId);
                // "ready" gelince (ya da gelmezse bir süre sonra) kullanıma hazır say
                let settled = false;
                let ready = function () {
                    if (!settled) {
                        settled = true;
                        resolve(wrapper);
                    }
                };
                controller.addListener("ready", ready);
                setTimeout(ready, SPOTIFY_READY_WAIT);
            });
        } catch (error) {
            clearTimeout(timer);
            box.remove();
            reject(new Error("Spotify oynatıcısı kurulamadı."));
        }
    });
}
