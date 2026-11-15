{
    // Map yapısı
    let cards = new Map();
    cards.set("apple", { word: "apple", type: "isim", meaning: "elma" });
    cards.set("book", { word: "book", type: "isim", meaning: "kitap" });
    cards.set("water", { word: "water", type: "isim", meaning: "su" });
    cards.set("run", { word: "run", type: "fiil", meaning: "koşmak" });
    cards.set("read", { word: "read", type: "fiil", meaning: "okumak" });
    cards.set("drink", { word: "drink", type: "fiil", meaning: "içmek" });

    // Set yapısı
    let learnedWords = new Set();
    learnedWords.add("apple");
    learnedWords.add("run");
    learnedWords.add("apple"); 

    // Kart yapısı
    function cardHtml(card) {
        let cardClass = "card";
        let status = "";
        if (learnedWords.has(card.word)) {
            cardClass = "card learned";
            status = "<span class='status'>öğrenildi</span>";
        }

        return "<div class='" + cardClass + "' onclick=\"this.classList.toggle('flipped')\">" +
                   "<div class='card-inner'>" +
                       "<div class='face front'>" +
                           "<span class='word'>" + card.word + "</span>" +
                           "<span class='type'>" + card.type + "</span>" +
                           status +
                       "</div>" +
                       "<div class='face back'>" +
                           "<span class='word'>" + card.meaning + "</span>" +
                       "</div>" +
                   "</div>" +
               "</div>";
    }

    // Mapte belirli türden kaç kelime olduğunu sayar
    function countByType(cards, type) {
        let count = 0;
        for (let card of cards.values()) {
            if (card.type === type) {
                count = count + 1;
            }
        }
        return count;
    }

    // İngilizce kelimeyi mapte arar, bulursa anlamını döndürür
    function findMeaning(cards, word) {
        if (cards.has(word)) {
            return cards.get(word).meaning;
        }
        return "Bulunamadı";
    }

    // Arrow fonksiyon
    let frontSide = (card) => card.word;

    let html = "";
    for (let card of cards.values()) {
        html = html + cardHtml(card);
    }
    // Kart kutusu sadece kartlar.html'de var
    let cardsBox = document.getElementById("cards");
    if (cardsBox) {
        cardsBox.innerHTML = html;
    }

    show("nounCount", countByType(cards, "isim"));
    show("verbCount", countByType(cards, "fiil"));
    show("readMeaning", findMeaning(cards, "read"));
    show("catMeaning", findMeaning(cards, "cat"));
    show("frontSide", frontSide(cards.get("apple")));
    show("learnedCount", learnedWords.size + " / " + cards.size);
}
