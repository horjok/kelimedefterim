// ===== Video sayfası: Gramer modu =====
// Sunucu (grammar.py) videonun transkriptini Gemini'ye gönderir ve gramer konularını döndürür:
//   GET /api/grammar?url=...  →  { model, truncated, topics: [{ title, titleTr, level, pattern, explanation, tip,
//                                   examples: [{ line, phrase, note }] }] }
// "line" transkriptteki satır numarasıdır (0'dan başlar): örneğe dokununca video o cümleyi çalar.
// video.js şu fonksiyonları çağırır: grammarReset(url), grammarOpen(). dictation.js: grammarForLine(lineIndex).

let grammarData = null;     // sunucudan gelen yanıt
let grammarUrl = "";        // hangi video için
let grammarTried = false;   // bu video için istek atıldı mı (hata olunca kendiliğinden tekrar denenmez)
let grammarRequest = 0;     // eski videonun cevabı yeni videonun üstüne yazılmasın

function grammarElement(tag, className, text) {
    let element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;  // textContent: modelden gelen yazı HTML olarak çalışmaz
    }
    return element;
}

function grammarSetStatus(text, className) {
    let status = document.getElementById("grammarStatus");
    status.textContent = text;
    status.className = className ? `transcript-hint ${className}` : "transcript-hint";
}

// Yeni video yüklendi
function grammarReset(url) {
    grammarRequest++;
    grammarData = null;
    grammarUrl = url;
    grammarTried = false;
    document.getElementById("grammarCount").textContent = "";
    document.getElementById("grammarTopics").innerHTML = "";
    document.getElementById("grammarHelp").hidden = true;
    document.getElementById("grammarRetry").hidden = true;
    grammarSetStatus("Bu videodaki gramer konuları Gemini ile çıkarılır.");
}

// Gramer modu açıldı: ilk açılışta kendiliğinden yükle
function grammarOpen() {
    if (!grammarTried) {
        grammarLoad();
    }
}

function grammarLoad() {
    if (!grammarUrl) {
        return;
    }
    let request = ++grammarRequest;
    grammarTried = true;
    document.getElementById("grammarTopics").innerHTML = "";
    document.getElementById("grammarHelp").hidden = true;
    document.getElementById("grammarRetry").hidden = true;
    grammarSetStatus("Gramer konuları çıkarılıyor… Genelde 5-10 saniye.");

    fetch(`/api/grammar?url=${encodeURIComponent(grammarUrl)}`)
        .then(function (response) {
            return response.json().then(function (data) {
                if (!response.ok) {
                    let error = new Error(data.error || `Sunucu hatası (kod ${response.status}).`);
                    error.code = data.code || "";
                    throw error;
                }
                return data;
            });
        })
        .then(function (data) {
            if (request !== grammarRequest) {
                return;  // bu arada başka video açıldı
            }
            grammarData = data;
            grammarRender();
            if (typeof dictationRenderGrammar === "function") {
                dictationRenderGrammar();  // dikte açıksa ekrandaki cümlenin grameri de görünsün
            }
        })
        .catch(function (error) {
            if (request !== grammarRequest) {
                return;
            }
            let message = error.message;
            if (error.name === "TypeError" || error.name === "SyntaxError") {
                message = "Sunucuya ulaşılamadı. Terminalde \"python server.py\" çalışıyor mu?";
            }
            grammarSetStatus(message, "error");
            document.getElementById("grammarHelp").hidden = error.code !== "no_key" && error.code !== "bad_key";
            document.getElementById("grammarRetry").hidden = false;
            console.error("Gramer hatası:", error);
        });
}

// Örnek cümle: ifade fosforlu kalemle işaretli
function grammarSentenceHtml(text, phrase) {
    let box = grammarElement("span", "grammar-sentence");
    let position = phrase ? text.toLowerCase().indexOf(phrase.toLowerCase()) : -1;
    if (position < 0) {
        box.textContent = text;
    } else {
        box.append(
            text.slice(0, position),
            grammarElement("mark", "", text.slice(position, position + phrase.length)),
            text.slice(position + phrase.length)
        );
    }
    return box;
}

function grammarExampleHtml(example) {
    let line = lines[example.line];
    let row = grammarElement("button", "grammar-example");
    row.type = "button";
    row.title = "Bu cümleyi videoda çal";
    row.addEventListener("click", function () {
        playFrom(example.line);  // gramer modunda shadowing açık: cümle sonunda durur
        updateShadowBar();
    });
    row.appendChild(grammarElement("span", "line-time", formatTime(line.start)));
    let body = grammarElement("span", "grammar-example-body");
    body.appendChild(grammarSentenceHtml(line.text, example.phrase));
    if (example.note) {
        body.appendChild(grammarElement("span", "grammar-note", example.note));
    }
    row.appendChild(body);
    return row;
}

function grammarRender() {
    let container = document.getElementById("grammarTopics");
    container.innerHTML = "";
    let topics = grammarData.topics.map(function (topic) {
        // Transkript bu arada değişmiş olamaz ama satırı olmayan örnek yine de atlanır
        return { ...topic, examples: topic.examples.filter((example) => lines[example.line]) };
    });
    document.getElementById("grammarCount").textContent = topics.length;

    topics.forEach(function (topic, index) {
        let card = grammarElement("article", "grammar-topic");
        card.id = `grammarTopic${index}`;

        let head = grammarElement("div", "grammar-head");
        head.appendChild(grammarElement("h4", "", topic.title));
        if (topic.level) {
            head.appendChild(grammarElement("span", "chip", topic.level));
        }
        card.appendChild(head);
        if (topic.titleTr) {
            card.appendChild(grammarElement("p", "grammar-title-tr", topic.titleTr));
        }
        if (topic.pattern) {
            card.appendChild(grammarElement("p", "grammar-pattern", topic.pattern));
        }
        card.appendChild(grammarElement("p", "grammar-explanation", topic.explanation));

        let examples = grammarElement("div", "grammar-examples");
        for (let example of topic.examples) {
            examples.appendChild(grammarExampleHtml(example));
        }
        card.appendChild(examples);

        if (topic.tip) {
            let tip = grammarElement("p", "grammar-tip");
            tip.append(grammarElement("b", "", "İpucu: "), topic.tip);
            card.appendChild(tip);
        }
        container.appendChild(card);
    });

    let note = `${topics.length} gramer konusu. Örneğe dokun, video o cümleyi çalsın. ` +
        `Yapay zekâ (${grammarData.model}) üretti; hata içerebilir.`;
    if (grammarData.truncated) {
        note += " Video uzun olduğu için yalnızca baştaki bölüm incelendi.";
    }
    grammarSetStatus(note);
}

// Bir transkript satırında geçen gramer konuları: [{ topicIndex, title, phrase, note }]
function grammarForLine(lineIndex) {
    if (!grammarData) {
        return [];
    }
    let found = [];
    grammarData.topics.forEach(function (topic, topicIndex) {
        for (let example of topic.examples) {
            if (example.line === lineIndex) {
                found.push({ topicIndex: topicIndex, title: topic.title, phrase: example.phrase, note: example.note });
                break;
            }
        }
    });
    return found;
}

// Gramer modunu açıp ilgili konuyu göster (dikteden çağrılır)
function grammarShowTopic(topicIndex) {
    setMode("grammar");
    let card = document.getElementById(`grammarTopic${topicIndex}`);
    if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        card.classList.add("flash");
        setTimeout(function () { card.classList.remove("flash"); }, 1600);
    }
}

document.getElementById("grammarRetry").addEventListener("click", grammarLoad);
