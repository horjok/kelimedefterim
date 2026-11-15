// ===== IELTS sayfası: Gramer tekrarı sekmesi =====
// Konular ielts-data.js IELTS_GRAMMAR içinde (sabit, Türkçe anlatım). Her konu için Gemini (IELTS eğitmeni personası)
// seçilen zorlukta alıştırma üretir: POST /api/ielts/grammar { topic, level } → { questions: [choice | gap] }.
// Yardımcılar: ielts.js (ieltsElement, ieltsRead, ieltsWrite, ieltsAddResult, ieltsShowTab),
//              ielts-practice.js (ieltsApi, ieltsStatus, ieltsLevel, ieltsRenderQuestions).
// localStorage: "ielts:grammar" { konuAnahtarı: { best, total, tries, at } }.

let gramTopic = null;  // açık konu
let gramSet = null;    // sunucudan gelen alıştırma
let gramActive = null; // ieltsRenderQuestions denetleyicisi

function gramProgress() {
    return ieltsRead("ielts:grammar", {});
}

function gramRenderTopics() {
    let box = document.getElementById("gramTopics");
    let progress = gramProgress();
    box.replaceChildren();
    for (let topic of IELTS_GRAMMAR) {
        let card = ieltsElement("button", "ielts-gram-card");
        card.type = "button";
        card.setAttribute("aria-pressed", gramTopic && gramTopic.key === topic.key ? "true" : "false");
        card.append(ieltsElement("span", "ielts-gram-title", topic.tr), ieltsElement("span", "ielts-gram-en", topic.title));
        let done = progress[topic.key];
        if (done) {
            let full = done.best === done.total;
            card.appendChild(ieltsElement("span", full ? "chip status-learned" : "chip status-learning", `en iyi ${done.best} / ${done.total}`));
        } else {
            card.appendChild(ieltsElement("span", "chip", "çalışılmadı"));
        }
        card.addEventListener("click", function () { gramOpen(topic.key); });
        box.appendChild(card);
    }
}

// Konunun anlatımını açar
function gramOpen(key) {
    let topic = IELTS_GRAMMAR.find((item) => item.key === key);
    if (!topic) {
        return;
    }
    gramTopic = topic;
    gramSet = null;
    gramActive = null;
    gramRenderTopics();
    let box = document.getElementById("gramDetail");
    box.hidden = false;
    box.replaceChildren();
    let head = ieltsElement("div", "ielts-section-head");
    head.append(ieltsElement("h3", "", topic.tr), ieltsElement("span", "chip", topic.title));
    box.appendChild(head);
    box.appendChild(ieltsElement("p", "ielts-note", `IELTS'te neden önemli: ${topic.why}`));
    box.appendChild(ieltsElement("p", "grammar-pattern", topic.pattern));
    box.appendChild(ieltsElement("p", "", topic.explain));
    box.appendChild(ieltsElement("h4", "dict-subtitle", "Örnekler"));
    let list = ieltsElement("ul", "ielts-list");
    for (let example of topic.examples) {
        list.appendChild(ieltsElement("li", "", example));
    }
    box.appendChild(list);
    box.appendChild(ieltsElement("h4", "dict-subtitle", "Sık yapılan hata"));
    let mistake = ieltsElement("div", "ielts-correction");
    mistake.append(ieltsElement("p", "ielts-original", topic.wrong), ieltsElement("p", "ielts-better", topic.right));
    box.appendChild(mistake);

    document.getElementById("gramPractice").hidden = false;
    document.getElementById("gramBody").hidden = true;
    document.getElementById("gramNew").textContent = "Alıştırma üret";
    ieltsStatus("gramStatus", "Konuyu okuduysan seviyeni seç ve alıştırma üret.");
    box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function gramNewQuiz() {
    if (!gramTopic) {
        return;
    }
    let button = document.getElementById("gramNew");
    button.disabled = true;
    ieltsStatus("gramStatus", "Alıştırma üretiliyor… Genelde 3-10 saniye.");
    let topicKey = gramTopic.key;
    ieltsApi("/api/ielts/grammar", { topic: topicKey, level: ieltsLevel("grammar") })
        .then(function (set) {
            if (!gramTopic || gramTopic.key !== topicKey) {
                return;  // bu arada başka konu açıldı
            }
            gramSet = set;
            document.getElementById("gramBody").hidden = false;
            document.getElementById("gramScore").textContent = "";
            document.getElementById("gramCheck").disabled = false;
            gramActive = ieltsRenderQuestions(document.getElementById("gramQuestions"), set.questions, null);
            button.textContent = "Yeni alıştırma üret";
            ieltsStatus("gramStatus", `Bant ${set.level} seviyesi · ${set.questions.length} soru. Yapay zekâ üretimidir, hata içerebilir.`);
        })
        .catch(function (error) { ieltsStatus("gramStatus", error.message, "error"); })
        .finally(function () { button.disabled = false; });
}

function gramCheckQuiz() {
    if (!gramActive || !gramTopic) {
        return;
    }
    let result = gramActive.check();
    document.getElementById("gramCheck").disabled = true;
    document.getElementById("gramScore").textContent = `${result.score} / ${result.total} doğru`;
    let progress = gramProgress();
    let old = progress[gramTopic.key];
    let better = !old || result.score / result.total > old.best / old.total;
    progress[gramTopic.key] = {
        best: better ? result.score : old.best,
        total: better ? result.total : old.total,
        tries: (old ? old.tries : 0) + 1,
        at: Date.now()
    };
    ieltsWrite("ielts:grammar", progress);
    ieltsAddResult({ kind: "grammar", title: gramTopic.tr, score: result.score, total: result.total });
    gramRenderTopics();
}

document.getElementById("gramNew").addEventListener("click", gramNewQuiz);
document.getElementById("gramCheck").addEventListener("click", gramCheckQuiz);
gramRenderTopics();
