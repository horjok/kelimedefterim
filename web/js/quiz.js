// ===== Ortak soru bileşeni: IELTS sayfası ve Gramer sayfası kullanır =====
// - ieltsElement(tag, className, text): güvenli (textContent ile) element oluşturur.
// - ieltsApi(path, body): sunucuya JSON isteği; hata olursa Türkçe mesajlı Error.
// - ieltsRenderQuestions(container, questions, extra): soruları çizer ve kontrol eder.
//   Soru tipleri: "tfng" (True/False/Not Given), "choice" (çoktan seçmeli), "gap" (boşluk doldurma; "accept" = kabul edilen başka cevaplar).
// Adlardaki "ielts" öneki tarihseldir (bileşen önce IELTS sayfası için yazıldı).

function ieltsElement(tag, className, text) {
    let element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;  // textContent: modelden gelen yazı HTML olarak çalışmaz
    }
    return element;
}

const IELTS_BLANK = "_____";
const IELTS_LETTERS = "ABCDEFGHIJ";

function ieltsNorm(text) {
    return String(text).replace(/’/g, "'").toLowerCase().replace(/\s+/g, " ").trim();
}

// Sunucuya JSON isteği. Hata olursa Türkçe mesajlı Error (error.code: no_key, quota, ...)
function ieltsApi(path, body) {
    let options = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(apiUrl(path), options).then(function (response) {
        return response.json().then(function (data) {
            if (!response.ok) {
                let error = new Error(data.error || `Sunucu hatası (kod ${response.status}).`);
                error.code = data.code || "";
                throw error;
            }
            return data;
        });
    }).catch(function (error) {
        if (error.name === "TypeError" || error.name === "SyntaxError") {
            throw new Error("Sunucuya ulaşılamadı. Terminalde \"python server.py\" çalışıyor mu?");
        }
        throw error;
    });
}

// ===== Sorular =====

// Soruları çizer; { check() → { score, total } } döndürür. extra(question) kontrol sonrası eklenecek öğeyi verir.
function ieltsRenderQuestions(container, questions, extra) {
    container.replaceChildren();
    let answers = questions.map(() => "");
    let cards = [];
    let checked = false;

    questions.forEach(function (question, index) {
        let card = ieltsElement("div", "ielts-question");
        let head = ieltsElement("p", "ielts-question-text");
        head.appendChild(ieltsElement("span", "ielts-number", String(index + 1)));

        if (question.type === "gap") {
            let parts = question.prompt.split(IELTS_BLANK);
            let input = ieltsElement("input", "dictation-slot");
            input.type = "text";
            input.autocomplete = "off";
            input.autocapitalize = "off";
            input.spellcheck = false;
            input.setAttribute("aria-label", `Soru ${index + 1} cevabı`);
            input.addEventListener("input", function () { answers[index] = input.value; });
            head.append(parts[0], input, parts.slice(1).join(IELTS_BLANK));
            card.appendChild(head);
        } else {
            head.append(question.prompt);
            card.appendChild(head);
            let choices = question.type === "tfng" ? ["TRUE", "FALSE", "NOT GIVEN"] : question.options;
            let group = ieltsElement("div", question.type === "tfng" ? "segmented ielts-tfng" : "ielts-options");
            choices.forEach(function (choice, choiceIndex) {
                let label = question.type === "tfng" ? choice : `${IELTS_LETTERS[choiceIndex]}  ${choice}`;
                let button = ieltsElement("button", question.type === "tfng" ? "" : "ielts-option", label);
                button.type = "button";
                button.dataset.value = choice;
                button.setAttribute("aria-pressed", "false");
                button.addEventListener("click", function () {
                    if (checked) {
                        return;
                    }
                    answers[index] = choice;
                    for (let other of group.children) {
                        other.setAttribute("aria-pressed", other === button ? "true" : "false");
                    }
                });
                group.appendChild(button);
            });
            card.appendChild(group);
        }
        container.appendChild(card);
        cards.push(card);
    });

    return {
        check: function () {
            checked = true;
            let score = 0;
            questions.forEach(function (question, index) {
                let card = cards[index];
                let accepted = [question.answer, ...(question.accept || [])].map(ieltsNorm);  // gramer: do not / don't
                let right = accepted.includes(ieltsNorm(answers[index]));
                if (right) {
                    score++;
                }
                card.classList.add(right ? "correct" : "wrong");
                for (let control of card.querySelectorAll("button, input")) {
                    control.disabled = true;
                    if (control.dataset.value && ieltsNorm(control.dataset.value) === ieltsNorm(question.answer)) {
                        control.classList.add("answer");
                    }
                }
                let old = card.querySelector(".ielts-feedback");
                if (old) {
                    old.remove();
                }
                let feedback = ieltsElement("div", "ielts-feedback");
                let line = ieltsElement("p", right ? "ok" : "error");
                line.append(right ? "✓ Doğru. " : (answers[index].trim() ? "✗ Yanlış. " : "✗ Boş. "), "Cevap: ", ieltsElement("b", "", question.answer));
                feedback.appendChild(line);
                if (question.explanation) {
                    feedback.appendChild(ieltsElement("p", "ielts-explanation", question.explanation));
                }
                let more = extra ? extra(question) : null;
                if (more) {
                    feedback.appendChild(more);
                }
                card.appendChild(feedback);
            });
            return { score: score, total: questions.length };
        }
    };
}
