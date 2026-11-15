let studyWords = [
    { text: "apple", type: "isim", meaning: "elma" },
    { text: "book", type: "isim", meaning: "kitap" },
    { text: "run", type: "fiil", meaning: "koşmak" }
];


// ===== 1. Template literal (interpolation) =====

function describeWord(word) {
    return `${word.text} (${word.type}) = ${word.meaning}`;
}

show("templateResult", describeWord(studyWords[2]));


// ===== 2. Spread (...) =====

let newWords = [
    { text: "read", type: "fiil", meaning: "okumak" },
    { text: "water", type: "isim", meaning: "su" }
];

let allWords = [...studyWords, ...newWords];

let learnedApple = { ...studyWords[0], learned: true };

let quizScores = [70, 85, 92, 60];
let bestScore = Math.max(...quizScores);

show("allWordsCount", `${studyWords.length} + ${newWords.length} = ${allWords.length}`);
show("copyLearned", learnedApple.learned);
show("originalLearned", studyWords[0].learned);
show("bestScore", bestScore);


// ===== 3. Destructuring =====

let [firstWord, secondWord] = allWords;

function shortLabel({ text, meaning }) {
    return `${text} → ${meaning}`;
}

show("firstTwo", `${firstWord.text}, ${secondWord.text}`);
show("shortLabel", shortLabel(allWords[3]));


// ===== 4. Debugging =====

console.log("Toplam kelime:", allWords.length);
console.log("Kopyalanan obje:", learnedApple);
console.table(allWords);


// ===== 5. Hatalar: throw, try, catch, finally =====

function validateWord(text, meaning) {
    if (text === "" || meaning === "") {
        throw new Error("Kelime ve anlam boş olamaz.");
    }
    for (let word of allWords) {
        if (word.text === text) {
            throw new Error(`"${text}" zaten listede var.`);
        }
    }
}

function addWord() {
    let textInput = document.getElementById("newText");
    let meaningInput = document.getElementById("newMeaning");
    let result = document.getElementById("addResult");

    let text = textInput.value.trim().toLowerCase();
    let meaning = meaningInput.value.trim();

    try {
        validateWord(text, meaning);  
        allWords = [...allWords, { text: text, type: "?", meaning: meaning }];

        let list = document.getElementById("liste");
        let item = document.createElement("li");
        item.textContent = `${list.children.length + 1}. ${text} = ${meaning}`;
        list.appendChild(item);

        result.textContent = `"${text}" eklendi. Listede ${allWords.length} kelime var.`;
        result.className = "ok";
        console.log("Eklendi:", text);
    } catch (error) {
        result.textContent = error.message;
        result.className = "error";
        console.warn("Eklenemedi:", error.message);
    } finally {
        textInput.value = "";
        meaningInput.value = "";
    }
}


// ===== 6. Promise: new Promise, resolve, reject, then, catch, finally =====

function loadWordPack(shouldFail) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            if (shouldFail) {
                reject(new Error("Kelime paketi yüklenemedi."));
            } else {
                resolve(["cat", "dog", "house", "drink"]);
            }
        }, 1500);
    });
}

function startLoading() {
    let button = document.getElementById("loadButton");
    let result = document.getElementById("loadResult");
    let shouldFail = document.getElementById("failLoad").checked;

    button.disabled = true;
    result.textContent = "Yükleniyor...";
    result.className = "";

    loadWordPack(shouldFail)
        .then(function (pack) {
            result.textContent = `${pack.length} kelime yüklendi: ${pack.join(", ")}`;
            result.className = "ok";
        })
        .catch(function (error) {
            result.textContent = `Hata: ${error.message}`;
            result.className = "error";
            console.error(error);
        })
        .finally(function () {
            button.disabled = false;
            console.log("Yükleme denemesi bitti.");
        });
}


// ===== 7. fetch: internetten veri çekme =====

let partOfSpeechNames = { n: "isim", v: "fiil", adj: "sıfat", adv: "zarf" };

function lookUpWord() {
    let word = document.getElementById("lookupText").value.trim().toLowerCase();
    let button = document.getElementById("lookupButton");
    let result = document.getElementById("lookupResult");

    if (word === "") {
        result.textContent = "Aramak için bir kelime yaz.";
        result.className = "error";
        return;
    }

    button.disabled = true;
    result.textContent = "Aranıyor...";
    result.className = "";

    // encodeURIComponent: kelimedeki boşluk gibi karakterleri adreste güvenli hale getirir
    fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=d&max=1`)
        .then(function (response) {
            if (!response.ok) {
                throw new Error(`Sözlük şu an cevap vermiyor (kod ${response.status}).`);
            }
            return response.json();
        })
        .then(function (data) {
            if (data.length === 0 || data[0].defs === undefined) {
                throw new Error(`"${word}" sözlükte bulunamadı.`);
            }

            // API'den gelen verileri düzgün bir şekilde ayırmak için destructuring kullanıyoruz
            let [shortType, definition] = data[0].defs[0].split("\t");
            let typeName = partOfSpeechNames[shortType];
            if (typeName === undefined) {
                typeName = shortType;
            }

            result.textContent = `${word} (${typeName}): ${definition}`;
            result.className = "ok";
        })
        .catch(function (error) {
            let message = error.message;
            if (error.name === "TypeError") {
                message = "Sözlüğe ulaşılamadı. İnternet bağlantını kontrol et ya da biraz sonra tekrar dene.";
            }
            result.textContent = message;
            result.className = "error";
            console.error("Sözlük hatası:", error);
        })
        .finally(function () {
            button.disabled = false;
        });
}


// ===== 8. async / await: zamanlı çalışma oturumu =====
    
function wait(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

async function startStudySession() {
    let button = document.getElementById("studyButton");
    let display = document.getElementById("studyDisplay");
    let progress = document.getElementById("studyProgress");

    button.disabled = true;
    try {
        for (let i = 0; i < allWords.length; i++) {
            let { text, meaning } = allWords[i];
            progress.textContent = `${i + 1} / ${allWords.length}`;

            display.textContent = text;
            await wait(1500);  

            display.textContent = `${text} = ${meaning}`;
            await wait(1500);
        }
        display.textContent = "Oturum bitti!";
        console.log(`Çalışma oturumu bitti: ${allWords.length} kelime`);
    } finally {
        button.disabled = false;
    }
}
