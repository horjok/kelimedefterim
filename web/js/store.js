// ===== Kayıtlı kelimeler: videodan kelime defterine ve kartlara =====
// Tüm sayfalar aynı kaydı paylaşır. Veri tarayıcıda durur: localStorage "savedWords".
//
// Her kayıt:
// { key, kind: "word" | "phrasal", word, tr, ipa, pos, level, art?, ← art: Almanca ismin artikeli (der, die, das)
//   example, clipStart, clipEnd,        ← kelimenin videoda geçtiği cümle ve o cümlenin saniyeleri
//   videoId, videoTitle, start, addedAt,
//   inList, inCards,                    ← defterde mi, çalışma kartlarında mı
//   box, due, reviews }                 ← aralıklı tekrar: kutu (0-5), sıradaki tekrar zamanı, tekrar sayısı
//
// Kural: kaydedilen her kelime defterdedir (inList). Kart olması ek bir işarettir (inCards).
// Defterden silinen kelime kartlardan da gider.

const SAVED_KEY = "savedWords";
const SAVED_DAY = 24 * 60 * 60 * 1000;

// Aralıklı tekrar (Leitner kutuları): kelime bilindikçe üst kutuya çıkar, tekrar aralığı uzar.
// Kutu numarası → kaç gün sonra tekrar sorulacağı.
const SAVED_INTERVALS = [0, 1, 3, 7, 14, 30];
const SAVED_LEARNED_BOX = 4;  // bu kutu ve üstü "öğrenildi" sayılır

// Kayıtlı tüm kelimeler (en eski en başta). Okunamazsa boş liste döner.
function savedAll() {
    let list;
    try {
        list = JSON.parse(localStorage.getItem(langKey(SAVED_KEY)));
    } catch (error) {
        return [];
    }
    if (!Array.isArray(list)) {
        return [];
    }
    // Eski sürümde kaydedilmiş kayıtları yeni alanlarla tamamla
    for (let entry of list) {
        if (entry.inCards) {
            entry.inList = true;
        }
        if (entry.box === undefined) {
            entry.box = entry.learned ? SAVED_LEARNED_BOX : 0;
            entry.due = 0;
            entry.reviews = entry.learned ? 1 : 0;
        }
    }
    return list;
}

// Yazılamazsa (gizli pencere, dolu depolama) false döner
function savedWriteAll(list) {
    try {
        localStorage.setItem(langKey(SAVED_KEY), JSON.stringify(list));
        return true;
    } catch (error) {
        console.warn("Kelimeler kaydedilemedi:", error);
        return false;
    }
}

// Aynı kelime iki kez kaydedilmesin diye anahtar: "w:garden" ya da "p:pick up"
function savedKey(kind, word) {
    return `${kind === "phrasal" ? "p" : "w"}:${word.toLowerCase()}`;
}

// Ekranda görünen ad: Almanca isimlerde artikeliyle ("der Tisch"; art alanı Pekiştir ve eş anlamlılardan gelir)
function savedHead(entry) {
    return entry.art ? `${entry.art} ${entry.word}` : entry.word;
}

function savedGet(key) {
    return savedAll().find((entry) => entry.key === key) || null;
}

// target: "inList" (sadece deftere) ya da "inCards" (deftere + kartlara).
function savedAdd(entry, target) {
    let list = savedAll();
    let existing = list.find((item) => item.key === entry.key);
    if (existing) {
        existing.inList = true;
        existing[target] = true;
        // Eski kayıtta videodaki cümle yoksa şimdi ekle
        if (!existing.example && entry.example) {
            existing.example = entry.example;
            existing.clipStart = entry.clipStart;
            existing.clipEnd = entry.clipEnd;
        }
    } else {
        list.push({
            ...entry,
            inList: true, inCards: target === "inCards",
            box: 0, due: 0, reviews: 0,
            addedAt: Date.now()
        });
    }
    return savedWriteAll(list);
}

// target "inCards": yalnızca kartlardan çıkarır, kelime defterde kalır.
// target "inList": kelimeyi tamamen siler (kartlardan da).
function savedRemove(key, target) {
    let list = savedAll();
    let existing = list.find((item) => item.key === key);
    if (!existing) {
        return true;
    }
    if (target === "inCards") {
        existing.inCards = false;
    } else {
        list = list.filter((item) => item.key !== key);
    }
    return savedWriteAll(list);
}


// ===== Aralıklı tekrar =====

// "new" (hiç çalışılmadı) | "learning" | "learned"
function savedStatus(entry) {
    if (entry.reviews === 0) return "new";
    if (entry.box >= SAVED_LEARNED_BOX) return "learned";
    return "learning";
}

const SAVED_STATUS_NAMES = { new: "yeni", learning: "öğreniliyor", learned: "öğrenildi" };

// Kartın tekrar zamanı geldi mi? (Yeni kartların due değeri 0'dır, hep sıradadır.)
function savedIsDue(entry, now) {
    return entry.inCards && (entry.due || 0) <= now;
}

// Cevaba göre kartın gideceği kutu ve kaç gün sonra sorulacağı.
// rating: 1 = bilmedim, 2 = zor, 3 = bildim, 4 = kolay
function savedPreview(entry, rating) {
    let top = SAVED_INTERVALS.length - 1;
    if (rating === 1) return { box: 1, days: 0 };                       // bu oturumda yeniden sorulur
    if (rating === 2) return { box: Math.max(1, entry.box), days: 1 };  // kutu değişmez, yarın yine
    let box = Math.min(top, entry.box + (rating === 4 ? 2 : 1));
    return { box: box, days: SAVED_INTERVALS[box] };
}

function savedReview(key, rating) {
    let list = savedAll();
    let existing = list.find((item) => item.key === key);
    if (!existing) {
        return true;
    }
    let next = savedPreview(existing, rating);
    existing.box = next.box;
    existing.due = Date.now() + next.days * SAVED_DAY;
    existing.reviews = (existing.reviews || 0) + 1;
    savedLogStudy();
    return savedWriteAll(list);
}


// ===== Çalışma günlüğü: hangi gün kaç kart çalışıldı (Bugün sayfasındaki seri için) =====
// localStorage "studyLog": { "2026-11-14": 12, ... }

const STUDY_LOG_KEY = "studyLog";

// Yerel saate göre "YYYY-AA-GG"
function savedDayKey(date) {
    let month = String(date.getMonth() + 1).padStart(2, "0");
    let day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function savedStudyLog() {
    try {
        let log = JSON.parse(localStorage.getItem(STUDY_LOG_KEY));
        return log && typeof log === "object" ? log : {};
    } catch (error) {
        return {};
    }
}

function savedLogStudy() {
    let log = savedStudyLog();
    let today = savedDayKey(new Date());
    log[today] = (log[today] || 0) + 1;
    try {
        localStorage.setItem(STUDY_LOG_KEY, JSON.stringify(log));
    } catch (error) { }
}

// Art arda kaç gündür çalışılıyor? Bugün henüz çalışılmadıysa seri dünden sayılır (bozulmuş sayılmaz).
function savedStreak() {
    let log = savedStudyLog();
    let day = new Date();
    if (!log[savedDayKey(day)]) {
        day.setDate(day.getDate() - 1);
    }
    let streak = 0;
    while (log[savedDayKey(day)]) {
        streak++;
        day.setDate(day.getDate() - 1);
    }
    return streak;
}

// Şarkıdan kaydedilen kelimenin videoId'si "sp:<Spotify parça id>" olur (video.js şarkı modu)
function savedIsSong(entry) {
    return /^sp:/.test(entry.videoId);
}

// Kelimenin videoda geçtiği yere götüren bağlantı (video.js ?v= ve &t= değerlerini okur)
function savedVideoLink(entry) {
    return `video.html?v=${encodeURIComponent(entry.videoId)}&t=${Math.floor(entry.start || 0)}`;
}
