// ===== Gramer sayfası: genel İngilizce dil bilgisi konuları =====
// - Müfredat: data/gramer.json (kategoriler ve konular; sunucu da aynı dosyayı okur). Her konunun "subtopics"
//   listesi o konunun içinde işlenen alt başlıklardır. Kademe: Temel = A1-A2, Orta = B1-B2, İleri = C1.
//   "summary" (birkaç cümlelik özet) ve "examples" (Türkçeli örnekler) elle yazıldı; konu açılınca Gemini'siz, hemen görünür.
// - Konu açılınca: özet (kalıp, kullanım, örnek) hemen görünür; ayrıntılı anlatım GET /api/lesson?topic=
//   (Gemini bir kez üretir, sunucuda saklanır); alıştırma POST /api/lesson/quiz.
// - Ortak parçalar quiz.js içinde: ieltsElement, ieltsApi, ieltsRenderQuestions.
// - Açık konu adreste durur: gramer.html#present-perfect (geri tuşu ve doğrudan bağlantı çalışır).
// localStorage: "gramer:progress" { konuAnahtarı: { read, best, total, tries, at } }.
// Diller (20 Kasım 2026): her dilin kendi müfredatı var (GRAMER_FILES). İspanyolcada konu adı "name",
// örnek cümle "text" alanında (İngilizcede "en"); gramerName / gramerText ikisini de okur.

const GRAMER_FILES = { en: "data/gramer.json", es: "data/gramer-es.json", de: "data/gramer-de.json" };
const GRAMER_TEXTS = {
    en: {
        hint: "İngilizce dil bilgisinin bütün konuları, temelden ileriye. Bir konu seç: anlatımı oku, örnekleri gör, alıştırmasını çöz.",
        search: "Konu ara: tense, modal, koşul, artikel…",
        credit: "Konu kapsamı, Grammar in Use serisinin temel, orta ve ileri seviye kitaplarında işlenen konularla karşılaştırılarak hazırlanmıştır. Anlatımlar, örnekler ve alıştırmalar özgündür; kitaplardan alınmamıştır.",
    },
    es: {
        hint: "İspanyolca (İspanya) dil bilgisinin temel konuları, A1'den C1'e. Bir konu seç: özeti ve örnekleri oku, ayrıntılı anlatımı aç, alıştırmasını çöz.",
        search: "Konu ara: subjuntivo, ser, por, geçmiş…",
        credit: "Konular ve seviyeleri yaklaşıktır; İspanyolca derslerindeki yaygın sıralama örnek alındı. Özetler, örnekler ve alıştırmalar özgündür; herhangi bir kitaptan alınmamıştır. Çekimler İspanya kullanımına göredir (vosotros dahil).",
    },
    de: {
        hint: "Almanca dil bilgisinin temel konuları, A1'den C1'e: artikeller, hâller, fiiller, yan cümleler. Bir konu seç: özeti ve örnekleri oku, ayrıntılı anlatımı aç, alıştırmasını çöz.",
        search: "Konu ara: Dativ, Perfekt, weil, artikel…",
        credit: "Konular ve seviyeleri yaklaşıktır; Almanca derslerindeki yaygın sıralama örnek alındı. Özetler, örnekler ve alıştırmalar özgündür; herhangi bir kitaptan alınmamıştır. Standart Almanca (Almanya) esas alındı.",
    },
};

function gramerName(topic) {
    return topic.name || topic.en || "";
}

function gramerText(example) {
    return example.text || example.en || "";
}

let gramerCategories = [];   // data/gramer.json
let gramerTopics = [];       // düz liste (önceki / sonraki için)
let gramerLevel = "";        // seviye süzgeci: "", "temel", "orta", "ileri" ya da A1…C1
const GRAMER_TIERS = { temel: ["A1", "A2"], orta: ["B1", "B2"], ileri: ["C1"] };

function gramerLevelMatches(topic) {
    if (!gramerLevel) {
        return true;
    }
    return GRAMER_TIERS[gramerLevel] ? GRAMER_TIERS[gramerLevel].includes(topic.level) : topic.level === gramerLevel;
}
let gramerOpenKey = "";      // açık konu
let gramerRequest = 0;       // geç gelen cevap başka konunun üstüne yazmasın
let gramerQuiz = null;

function gramerProgress() {
    try {
        let value = JSON.parse(localStorage.getItem(langKey("gramer:progress")));
        return value && typeof value === "object" ? value : {};
    } catch (error) {
        return {};
    }
}

function gramerSaveProgress(key, change) {
    let progress = gramerProgress();
    progress[key] = { ...(progress[key] || {}), ...change, at: Date.now() };
    try {
        localStorage.setItem(langKey("gramer:progress"), JSON.stringify(progress));
    } catch (error) {
        // depolama kapalıysa ilerleme tutulmaz
    }
}

function gramerStatus(id, text, className) {
    let status = document.getElementById(id);
    status.textContent = text;
    status.className = className ? `transcript-hint ${className}` : "transcript-hint";
}

function gramerFind(key) {
    return gramerTopics.find((topic) => topic.key === key) || null;
}


// ----- Konu listesi -----

function gramerRenderList() {
    let box = document.getElementById("grList");
    let query = document.getElementById("grSearch").value.trim().toLocaleLowerCase("tr");
    let progress = gramerProgress();
    let shown = 0;
    box.replaceChildren();

    for (let category of gramerCategories) {
        let topics = category.topics.filter(function (topic) {
            // Kategori adı da aranır: "modal" yazınca Kipler (Modals) başlığındaki bütün konular çıksın
            let text = `${category.name} ${topic.tr} ${gramerName(topic)} ${topic.pattern} ${topic.use} ${(topic.subtopics || []).join(" ")} ${topic.summary || ""}`.toLocaleLowerCase("tr");
            return gramerLevelMatches(topic) && (!query || text.includes(query));
        });
        if (topics.length === 0) {
            continue;
        }
        let panel = ieltsElement("article", "panel gr-category");
        panel.appendChild(ieltsElement("h3", "", category.name));
        let grid = ieltsElement("div", "ielts-gram-grid");
        for (let topic of topics) {
            let card = ieltsElement("a", "ielts-gram-card gr-card");
            card.href = `#${topic.key}`;
            card.append(ieltsElement("span", "ielts-gram-title", topic.tr), ieltsElement("span", "ielts-gram-en", gramerName(topic)));
            let chips = ieltsElement("span", "gr-chips");
            chips.appendChild(ieltsElement("span", `chip gr-level gr-level-${topic.level}`, topic.level));
            let done = progress[topic.key];
            if (done && done.total) {
                chips.appendChild(ieltsElement("span", done.best === done.total ? "chip status-learned" : "chip status-learning", `en iyi ${done.best} / ${done.total}`));
            } else if (done && done.read) {
                chips.appendChild(ieltsElement("span", "chip status-new", "okundu"));
            }
            card.appendChild(chips);
            grid.appendChild(card);
            shown++;
        }
        panel.appendChild(grid);
        box.appendChild(panel);
    }
    if (shown === 0) {
        box.appendChild(ieltsElement("p", "saved-empty", "Bu aramaya uyan konu yok."));
    }
    let read = gramerTopics.filter((topic) => progress[topic.key] && progress[topic.key].read).length;
    let solved = gramerTopics.filter((topic) => progress[topic.key] && progress[topic.key].total).length;
    let tierCount = (tier) => gramerTopics.filter((topic) => GRAMER_TIERS[tier].includes(topic.level)).length;
    document.getElementById("grSummary").textContent =
        `${shown} / ${gramerTopics.length} konu gösteriliyor (Temel ${tierCount("temel")} · Orta ${tierCount("orta")} · İleri ${tierCount("ileri")}) · ` +
        `${read} konu okundu · ${solved} konunun alıştırması çözüldü`;
}


// ----- Konu sayfası -----

function gramerShowBrowse() {
    gramerOpenKey = "";
    gramerRequest++;
    if (typeof timelineHide === "function") {
        timelineHide();
    }
    document.getElementById("grLesson").hidden = true;
    document.getElementById("grBrowse").hidden = false;
    gramerRenderList();
}

function gramerOpen(key) {
    let topic = gramerFind(key);
    if (!topic) {
        gramerShowBrowse();
        return;
    }
    gramerOpenKey = key;
    gramerQuiz = null;
    document.getElementById("grBrowse").hidden = true;
    document.getElementById("grLesson").hidden = false;

    let head = document.getElementById("grHead");
    head.replaceChildren(ieltsElement("h3", "", topic.tr), ieltsElement("span", "chip", gramerName(topic)),
        ieltsElement("span", `chip gr-level gr-level-${topic.level}`, topic.level));
    let core = document.getElementById("grCore");
    core.replaceChildren(
        ieltsElement("p", "grammar-pattern", topic.pattern),
        ieltsElement("p", "gr-summary", topic.summary || topic.use)
    );
    if (topic.examples && topic.examples.length) {
        let list = ieltsElement("ul", "ielts-list gr-examples");
        for (let example of topic.examples) {
            let row = ieltsElement("li");
            row.appendChild(gramerExampleRow(gramerText(example), example.tr));
            list.appendChild(row);
        }
        core.appendChild(list);
    } else {
        core.appendChild(ieltsElement("p", "gr-example", topic.example));
    }

    let subs = topic.subtopics || [];
    let subList = document.getElementById("grSubList");
    subList.replaceChildren();
    for (let text of subs) {
        subList.appendChild(ieltsElement("li", "", text));
    }
    document.getElementById("grSubs").hidden = subs.length === 0;

    let index = gramerTopics.indexOf(topic);
    document.getElementById("grPrev").disabled = index <= 0;
    document.getElementById("grNext").disabled = index >= gramerTopics.length - 1;

    document.getElementById("grQuizBody").hidden = true;
    document.getElementById("grQuizNew").textContent = "Alıştırma üret";
    gramerStatus("grQuizStatus", `Konuyu okuduktan sonra ${topic.level} seviyesinde 8 soruluk bir alıştırma çöz.`);
    gramerLoadLesson(false);
    window.scrollTo({ top: 0 });
}

function gramerExampleRow(example, translation) {
    let row = ieltsElement("span", "gr-pair");
    row.appendChild(ieltsElement("span", "gr-en", example));
    if (translation) {
        row.appendChild(ieltsElement("span", "gr-tr", translation));
    }
    return row;
}

function gramerRenderLesson(lesson) {
    let box = document.getElementById("grBody");
    box.replaceChildren();
    box.appendChild(ieltsElement("p", "gr-intro", lesson.intro));

    if (lesson.forms.length) {
        box.appendChild(ieltsElement("h4", "dict-subtitle", "Yapı"));
        let table = ieltsElement("div", "gr-forms");
        for (let form of lesson.forms) {
            let row = ieltsElement("div", "gr-form");
            row.appendChild(ieltsElement("span", "gr-form-name", form.name));
            let body = ieltsElement("span", "gr-form-body");
            body.append(ieltsElement("span", "grammar-pattern", form.pattern), gramerExampleRow(form.example, form.tr));
            row.appendChild(body);
            table.appendChild(row);
        }
        box.appendChild(table);
    }

    box.appendChild(ieltsElement("h4", "dict-subtitle", "Ne zaman kullanılır?"));
    // Kurallar alt başlığa göre gruplanır (anlatım alt başlık verdiyse); aynı alt başlık art arda gelirse tek başlık
    let uses = null;
    let lastSub = null;
    for (let use of lesson.uses) {
        let sub = use.sub || "";
        if (uses === null || sub !== lastSub) {
            if (sub) {
                box.appendChild(ieltsElement("p", "gr-sub-title", sub));
            }
            uses = ieltsElement("ul", "ielts-list gr-uses");
            box.appendChild(uses);
            lastSub = sub;
        }
        let row = ieltsElement("li");
        row.append(ieltsElement("span", "gr-rule", use.rule), gramerExampleRow(use.example, use.tr));
        uses.appendChild(row);
    }

    if (lesson.signals.length) {
        box.appendChild(ieltsElement("h4", "dict-subtitle", "İpucu kelimeler"));
        let chips = ieltsElement("p", "meta");
        for (let word of lesson.signals) {
            chips.appendChild(ieltsElement("span", "chip", word));
        }
        box.appendChild(chips);
    }

    if (lesson.mistakes.length) {
        box.appendChild(ieltsElement("h4", "dict-subtitle", "Sık yapılan hatalar"));
        for (let mistake of lesson.mistakes) {
            let card = ieltsElement("div", "ielts-correction");
            card.append(ieltsElement("p", "ielts-original", mistake.wrong), ieltsElement("p", "ielts-better", mistake.right));
            if (mistake.why) {
                card.appendChild(ieltsElement("p", "ielts-explanation", mistake.why));
            }
            box.appendChild(card);
        }
    }

    if (lesson.compare) {
        box.appendChild(ieltsElement("h4", "dict-subtitle", "Karıştırma"));
        box.appendChild(ieltsElement("p", "", lesson.compare));
    }
    if (lesson.tip) {
        let tip = ieltsElement("p", "ielts-note");
        tip.append(ieltsElement("b", "", "Aklında kalsın: "), lesson.tip);
        box.appendChild(tip);
    }
    document.getElementById("grSource").textContent =
        `Bu anlatımı yapay zekâ (${lesson.model}) bir ${langName()} öğretmeni rolünde yazdı; hata içerebilir. Bir kez üretilir ve saklanır.`;
    document.getElementById("grFoot").hidden = false;
}

function gramerLoadLesson(fresh) {
    let key = gramerOpenKey;
    let request = ++gramerRequest;
    document.getElementById("grBody").replaceChildren();
    document.getElementById("grFoot").hidden = true;
    gramerStatus("grStatus", "Ayrıntılı anlatım hazırlanıyor… İlk açılışta 3-10 saniye sürer, sonra hemen gelir.");
    ieltsApi(`/api/lesson?topic=${encodeURIComponent(key)}${fresh ? "&fresh=1" : ""}`)
        .then(function (lesson) {
            if (request !== gramerRequest) {
                return;  // bu arada başka konu açıldı
            }
            gramerStatus("grStatus", "");
            gramerRenderLesson(lesson);
            gramerSaveProgress(key, { read: true });
        })
        .catch(function (error) {
            if (request !== gramerRequest) {
                return;
            }
            gramerStatus("grStatus", `${error.message} Yukarıdaki özet yine de kullanılabilir.`, "error");
            let retry = ieltsElement("button", "mini", "Yeniden dene");
            retry.type = "button";
            retry.addEventListener("click", function () { gramerLoadLesson(false); });
            document.getElementById("grBody").replaceChildren(retry);
        });
}


// ----- Alıştırma -----

function gramerNewQuiz() {
    let key = gramerOpenKey;
    let button = document.getElementById("grQuizNew");
    button.disabled = true;
    gramerStatus("grQuizStatus", "Alıştırma üretiliyor… Genelde 3-10 saniye.");
    ieltsApi("/api/lesson/quiz", { topic: key })
        .then(function (set) {
            if (key !== gramerOpenKey) {
                return;
            }
            document.getElementById("grQuizBody").hidden = false;
            document.getElementById("grScore").textContent = "";
            document.getElementById("grCheck").disabled = false;
            gramerQuiz = ieltsRenderQuestions(document.getElementById("grQuestions"), set.questions, null);
            button.textContent = "Yeni alıştırma üret";
            gramerStatus("grQuizStatus", `${set.questions.length} soru · ${set.level} seviyesi. Yapay zekâ üretimidir, hata içerebilir.`);
        })
        .catch(function (error) { gramerStatus("grQuizStatus", error.message, "error"); })
        .finally(function () { button.disabled = false; });
}

function gramerCheckQuiz() {
    if (!gramerQuiz || !gramerOpenKey) {
        return;
    }
    let result = gramerQuiz.check();
    document.getElementById("grCheck").disabled = true;
    document.getElementById("grScore").textContent = `${result.score} / ${result.total} doğru`;
    let old = gramerProgress()[gramerOpenKey] || {};
    let better = !old.total || result.score / result.total > old.best / old.total;
    gramerSaveProgress(gramerOpenKey, {
        best: better ? result.score : old.best,
        total: better ? result.total : old.total,
        tries: (old.tries || 0) + 1
    });
}


// ----- Başlangıç -----

function gramerRoute() {
    let key = decodeURIComponent(location.hash.slice(1));
    // Zaman çizgisi (zamanlar.js; yalnızca İngilizce): gramer.html#zaman-cizgisi
    if (key === "zaman-cizgisi" && typeof timelineOpen === "function" && timelineOpen()) {
        return;
    }
    if (typeof timelineHide === "function") {
        timelineHide();
    }
    if (key && gramerFind(key)) {
        gramerOpen(key);
    } else {
        gramerShowBrowse();
    }
}

function gramerStep(offset) {
    let topic = gramerTopics[gramerTopics.indexOf(gramerFind(gramerOpenKey)) + offset];
    if (topic) {
        location.hash = topic.key;
    }
}

document.getElementById("grSearch").addEventListener("input", gramerRenderList);
for (let button of document.querySelectorAll("#grLevels button")) {
    button.addEventListener("click", function () {
        gramerLevel = button.dataset.level;
        for (let other of document.querySelectorAll("#grLevels button")) {
            other.setAttribute("aria-pressed", other === button ? "true" : "false");
        }
        gramerRenderList();
    });
}
document.getElementById("grBack").addEventListener("click", function () {
    history.pushState(null, "", location.pathname);
    gramerShowBrowse();
});
document.getElementById("grPrev").addEventListener("click", function () { gramerStep(-1); });
document.getElementById("grNext").addEventListener("click", function () { gramerStep(1); });
document.getElementById("grRefresh").addEventListener("click", function () { gramerLoadLesson(true); });
document.getElementById("grQuizNew").addEventListener("click", gramerNewQuiz);
document.getElementById("grCheck").addEventListener("click", gramerCheckQuiz);
window.addEventListener("hashchange", gramerRoute);
window.addEventListener("popstate", gramerRoute);

{
    let texts = GRAMER_TEXTS[currentLang()] || GRAMER_TEXTS.en;
    document.querySelector("#gramer > .section-hint").textContent = texts.hint;
    document.querySelector(".gr-credit").textContent = texts.credit;
    document.getElementById("grSearch").placeholder = texts.search;
}

fetch(GRAMER_FILES[currentLang()] || GRAMER_FILES.en)
    .then(function (response) { return response.json(); })
    .then(function (data) {
        gramerCategories = data.categories;
        gramerTopics = data.categories.flatMap((category) => category.topics);
        gramerRoute();
    })
    .catch(function () {
        document.getElementById("grList").replaceChildren(
            ieltsElement("p", "error", "Konu listesi yüklenemedi. Sunucu çalışıyor mu? (python server.py)"));
    });
