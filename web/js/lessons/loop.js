{
    let words = ["apple", "book", "cat", "dog", "water"];
    let meanings = ["elma", "kitap", "kedi", "köpek", "su"];
    let learned = [true, false, true, false, false];

    let list = "";
    for (let i = 0; i < words.length; i++) {
        list += "<li>" + (i + 1) + ". " + words[i] + " = " + meanings[i] + "</li>";
    }

    let correctAnswers = 0;
    let attempts = 0;
    let results = "";
    while (correctAnswers < 3) {
        attempts++;
        if (Math.random() > 0.3) {
            correctAnswers++;
            results += "+ ";
        } else {
            results += "x ";
        }
    }

    document.getElementById("liste").innerHTML = list;
    show("sonuclar", results);
    show("denemeSayisi", attempts);

}
