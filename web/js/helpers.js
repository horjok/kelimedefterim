// Sayfalar ayrıldığı için bir id her sayfada bulunmayabilir.
// show(): element varsa yazar, yoksa sessizce geçer (script hata verip durmaz).
function show(id, value) {
    let element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}
