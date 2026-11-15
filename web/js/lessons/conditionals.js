{
    let score = 99
    let level = "";

    if (score >= 100 && score <= 120) {
        level = "C2";
    } else if (score >= 90) {
        level = "C1";
    } else if (score >= 80) {
        level = "B2";
    } else if (score >= 70) {
        level = "B1";
    } else if (score >= 60) {
        level = "A2";
    } else if (score >= 50) {
        level = "A1";
    } else {
        level = "Seviye yok";
    }

    let language = "en";
    let languageName = "";

    switch (language) {
        case "en":
            languageName = "İngilizce";
            break;
        case "de":
            languageName = "Almanca";
            break;
        case "es":
            languageName = "İspanyolca";
            break;
        default:
            languageName = "Desteklenmiyor";
    }

    let answer = "book";
    let answerResult = "";

    if (answer === "kitap") {
        answerResult = "Doğru!";
    } else {
        answerResult = "Yanlış. Doğru cevap: kitap";
    }

    show("kosul-puan", score);
    show("seviyeSonucu", level);
    show("dilAdi", languageName);
    show("cevap", answer);
    show("cevapSonucu", answerResult);
}
