// Bütün sayfalarda yüklenir. (Eski "Kurs:" dil seçimi 16 Kasım 2026'da kaldırıldı; dosya adı o günden kalma.)
// Telefonda alt menü yana kayar: açık sayfanın sekmesi görünür olsun
{
    let nav = document.querySelector(".nav");
    let current = nav ? nav.querySelector('a[aria-current="page"]') : null;
    if (current && nav.scrollWidth > nav.clientWidth) {
        nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
    }
}
