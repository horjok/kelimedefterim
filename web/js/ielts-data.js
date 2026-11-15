// ===== IELTS bölümü: sabit içerik =====
// Sınav yapısı, değerlendirme ölçütleri, taktikler ve yol haritası şablonları.
// Süre, soru sayısı, kelime sınırı ve bant yuvarlama kuralı 15 Kasım 2026'da ielts.org'dan doğrulandı.
// Bu dosyada yalnızca veri var; sayfayı ielts.js çizer.

const IELTS_MODULES = { academic: "Academic", general: "General Training" };

// Dört bölüm. "both" iki sınav türünde ortak; "academic"/"general" türe göre değişen satırlar.
const IELTS_SECTIONS = [
    {
        key: "listening", name: "Listening", time: "Yaklaşık 30 dakika", count: "4 bölüm · 40 soru",
        both: [
            "Kayıt yalnızca bir kez çalınır; sorular kayıttaki bilginin sırasıyla gelir.",
            "Bölüm 1: gündelik bir konuda iki kişinin konuşması. Bölüm 2: gündelik bir konuda tek kişinin konuşması.",
            "Bölüm 3: eğitim ortamında birkaç kişinin tartışması. Bölüm 4: akademik bir konuda tek kişinin anlatımı.",
            "Soru tipleri: form/not/tablo tamamlama, çoktan seçmeli, eşleştirme, harita ya da plan işaretleme, cümle tamamlama.",
            "Kâğıt sınavda cevapları cevap kâğıdına geçirmek için ayrıca 10 dakika verilir."
        ]
    },
    {
        key: "reading", name: "Reading", time: "60 dakika", count: "3 bölüm · 40 soru",
        both: [
            "Cevapları geçirmek için ek süre yoktur; 60 dakikanın içinde yazılır.",
            "Soru tipleri: True/False/Not Given, Yes/No/Not Given, başlık eşleştirme, bilgi eşleştirme, çoktan seçmeli, cümle/özet/tablo tamamlama, kısa cevap."
        ],
        academic: ["Üç uzun metin (toplam 2150–2750 kelime): kitap, dergi ve gazetelerden, uzman olmayan okur için yazılmış akademik konular."],
        general: ["Bölüm 1: gündelik hayattan kısa metinler (ilan, duyuru, tarife). Bölüm 2: iş hayatıyla ilgili metinler. Bölüm 3: genel bir konuda daha uzun bir metin (toplam 2150–2375 kelime)."]
    },
    {
        key: "writing", name: "Writing", time: "60 dakika", count: "2 görev",
        both: [
            "Task 2: bir görüş, tartışma ya da sorun üzerine en az 250 kelimelik yazı; yaklaşık 40 dakika.",
            "Task 2, Writing puanına Task 1'in iki katı katkı yapar: süreni buna göre böl.",
            "Alt sınırın altında kalan cevap puan kaybeder; fazla yazmak ceza getirmez ama zamanını yer."
        ],
        academic: ["Task 1: bir grafik, tablo, şema ya da süreci kendi cümlelerinle anlat; en az 150 kelime, yaklaşık 20 dakika."],
        general: ["Task 1: verilen duruma göre bir mektup yaz (kişisel, yarı resmi ya da resmi); üç maddenin hepsini karşıla; en az 150 kelime, yaklaşık 20 dakika."]
    },
    {
        key: "speaking", name: "Speaking", time: "11–14 dakika", count: "3 bölüm · yüz yüze görüşme",
        both: [
            "Bölüm 1 (4–5 dk): ev, iş, okul, hobiler gibi tanıdık konularda kısa sorular.",
            "Bölüm 2 (3–4 dk): bir konu kartı verilir; 1 dakika hazırlanır, 2 dakikaya kadar tek başına konuşursun.",
            "Bölüm 3 (4–5 dk): Bölüm 2'nin konusuyla bağlantılı, daha soyut sorular üzerine tartışma.",
            "İki sınav türünde de aynıdır."
        ]
    }
];

// Writing ve Speaking dört ölçütle puanlanır; ölçütler eşit ağırlıklıdır.
const IELTS_CRITERIA = {
    writing: [
        { key: "task", name: "Task Achievement / Task Response", tr: "Görevi karşılama", hint: "Sorunun her parçasına cevap verdin mi, görüşün açık mı, fikirlerini açıklayıp örnekledin mi?" },
        { key: "coherence", name: "Coherence and Cohesion", tr: "Tutarlılık ve bağlantı", hint: "Paragraflar mantıklı sırada mı, her paragrafın tek bir ana fikri var mı, bağlaçlar doğal mı?" },
        { key: "lexical", name: "Lexical Resource", tr: "Kelime kullanımı", hint: "Kelime çeşitliliği, doğru eşdizimler (collocation), yazım." },
        { key: "grammar", name: "Grammatical Range and Accuracy", tr: "Dil bilgisi", hint: "Basit ve bileşik cümleleri birlikte ve hatasız kullanma, noktalama." }
    ],
    speaking: [
        { key: "fluency", name: "Fluency and Coherence", tr: "Akıcılık ve tutarlılık", hint: "Uzun duraksamadan, kendini çok tekrar etmeden konuşabildin mi; fikirlerin birbirine bağlı mı?" },
        { key: "lexical", name: "Lexical Resource", tr: "Kelime kullanımı", hint: "Konuya uygun kelimeler kullandın mı; bilmediğin kelimeyi başka sözlerle anlatabildin mi?" },
        { key: "grammar", name: "Grammatical Range and Accuracy", tr: "Dil bilgisi", hint: "Farklı zamanlar ve yapılar kullandın mı; hatalar anlamayı zorlaştırdı mı?" },
        { key: "pronunciation", name: "Pronunciation", tr: "Telaffuz", hint: "Kelime vurgusu, cümle tonlaması ve seslerin anlaşılırlığı." }
    ]
};

// Taktikler: beceriye göre. "module" verilmişse yalnızca o sınav türünde gösterilir.
const IELTS_TACTICS = [
    {
        key: "listening", name: "Listening", items: [
            { title: "Kayıt başlamadan soruları oku", text: "Her bölümden önce verilen sürede soruların altını çiz: ne tür bir bilgi isteniyor (isim, sayı, tarih, yer)? Kulağın neyi arayacağını bilsin." },
            { title: "Kelime sınırına uy", text: "\"NO MORE THAN TWO WORDS\" yazıyorsa üç kelime yanlış sayılır. Sınırı her soru grubunda yeniden kontrol et." },
            { title: "Çeldiriciye dikkat", text: "Konuşmacı çoğu zaman önce yanlış bilgiyi söyler, sonra düzeltir (\"…on Tuesday. Oh no, sorry, Thursday\"). İlk duyduğunu hemen yazıp bırakma." },
            { title: "Kaçırdığın soruda takılma", text: "Kayıt bir kez çalınır. Bir cevabı kaçırdıysan tahminini yaz ve bir sonraki soruya geç; yoksa peş peşe üç soru gider." },
            { title: "Yazım puan kaybettirir", text: "Yanlış yazılan cevap yanlış sayılır. Aylar, günler, sık geçen isimler ve çoğul ekleri üzerinde ayrıca çalış." },
            { title: "Bu uygulamada", text: "Video sayfasındaki Dikte modu tam bu beceriyi çalıştırır: duyduğunu harfi harfine yazmak. Önce Kolay, sonra Zor seviyede dene.", link: "video.html", linkText: "Video · Dikte" }
        ]
    },
    {
        key: "reading", name: "Reading", items: [
            { title: "Süreyi üçe böl", text: "Üç bölüm için 60 dakikan var ve bölümler giderek zorlaşır. Kabaca 17 – 20 – 23 dakika ayır; bir soruya iki dakikadan fazla takılma." },
            { title: "Önce sorular, sonra metin", text: "Metni baştan sona okumak yerine başlığı ve paragrafların ilk cümlelerini tara, sonra soruya git ve cevabın geçtiği yeri bul." },
            { title: "False ile Not Given farkı", text: "FALSE: metin ifadenin tersini söylüyor. NOT GIVEN: metinde bu bilgi hiç yok. Kendi genel bilginle değil, yalnızca metinde yazanla karar ver." },
            { title: "Eş anlamlıları ara", text: "Sorudaki kelime metinde aynen geçmez; başka sözlerle anlatılır (\"increase\" → \"a rise in\"). Anahtar kelimenin eş anlamlısını ve zıddını düşün." },
            { title: "Başlık eşleştirmede ana fikre bak", text: "Paragrafta geçen tek bir kelimeye değil, paragrafın tamamının ne anlattığına göre başlık seç. Emin olduklarını önce eşleştir." },
            { title: "Boş bırakma", text: "Yanlış cevaptan puan düşülmez. Süre biterken boş kalan her soruya tahminini yaz." }
        ]
    },
    {
        key: "writing", name: "Writing", items: [
            { title: "Task 2'ye 40 dakika ayır", text: "Task 2 iki kat değerlidir. İstersen önce Task 2'yi yaz; Task 1'i 20 dakikada bitir." },
            { title: "Yazmadan önce 3–5 dakika planla", text: "Görüşünü ve iki ana fikrini, her biri için bir örnekle not et. Plansız başlayan yazı çoğu zaman konudan kayar." },
            { title: "Task 2 iskeleti", text: "Giriş: konuyu kendi cümlenle yeniden yaz + görüşün. İki gelişme paragrafı: ana fikir → açıklama → örnek. Sonuç: görüşünü yeni sözlerle özetle; yeni fikir ekleme." },
            { title: "Sorunun her parçasına cevap ver", text: "\"Discuss both views and give your opinion\" üç iş ister: bir görüş, öbür görüş, senin görüşün. Birini atlarsan Task Response puanı düşer." },
            { title: "Task 1: genel görünümü yaz", module: "academic", text: "Girişten sonra bir \"overview\" cümlesiyle en belirgin eğilimi ya da karşılaştırmayı söyle. Her sayıyı tek tek yazma; gruplayıp karşılaştır. Kendi yorumunu ve nedenini ekleme." },
            { title: "Task 1: üç maddeyi de karşıla", module: "general", text: "Mektuptaki üç maddenin her birine en az iki üç cümle ayır. Tonu alıcıya göre seç: arkadaşa \"Hi Tom\", yetkiliye \"Dear Sir or Madam\" ve buna uygun kapanış." },
            { title: "Son 3 dakikayı kontrole ayır", text: "Özne-fiil uyumu, tekil/çoğul, artikeller, zamanlar ve yazım. En sık yaptığın üç hatayı bil ve yalnızca onları ara." },
            { title: "Ezber kalıp yığma", text: "Konuyla ilgisi olmayan ezber cümleler puan getirmez. Az ama doğru kullanılan bağlaç ve kalıp, çok ama yanlış kullanılandan iyidir." }
        ]
    },
    {
        key: "speaking", name: "Speaking", items: [
            { title: "Kısa cevap verme, ezber de okuma", text: "Bölüm 1'de her soruya iki üç cümle: cevap + neden + küçük bir örnek. Ezberlenmiş cevap sınav görevlisince fark edilir." },
            { title: "Bölüm 2: 1 dakikada not al", text: "Karttaki dört madde için birer anahtar kelime yaz. Konuşurken maddeleri sırayla izle; son madde (\"explain why…\") en uzun kısmın olsun." },
            { title: "Durana kadar konuş", text: "Bölüm 2'de görevli seni durdurana kadar konuşmaya çalış. Söyleyeceğin bittiyse bir örnek, bir anı ya da bir karşılaştırma ekle." },
            { title: "Bölüm 3: görüş + gerekçe + örnek", text: "Soyut sorularda genelle: \"In general…\", \"It depends on…\". Bir görüş söyle, nedenini açıkla, örnek ver, gerekirse karşı görüşe değin." },
            { title: "Kelime bulamazsan anlat", text: "Bildiğin kelimelerle tarif et (\"the thing you use to…\"). Susmak, yanlış bir kelime kullanmaktan daha çok puan kaybettirir." },
            { title: "Anlamadıysan sor", text: "\"Could you repeat that, please?\" demek puan kaybettirmez; yanlış soruya cevap vermek kaybettirir." },
            { title: "Bu uygulamada", text: "Video sayfasında cümleleri gölgeleyerek (shadowing) tonlamayı, \"Sondan başa\" alıştırmasıyla uzun cümle ve kelimelerin telaffuzunu çalış; kendini kaydedip dinle.", link: "video.html", linkText: "Video · Transkript" }
        ]
    }
];

// Yol haritası: evreler ve haftalık görev şablonları.
// {n} haftalık tekrar sayısı (günlük süreye göre hesaplanır).
const IELTS_PHASES = [
    {
        key: "temel", name: "Temel", goal: "Sınavı tanı, seviyeni ölç, kelime ve dil bilgisi temelini kur.",
        tasks: [
            { key: "format", text: "Genel bakış ve Taktikler sekmelerini oku; dört bölümün süresini ve soru tiplerini ezberle.", link: "ielts.html#genel", once: true },
            { key: "olcum", text: "Seviye ölçümü: bir Reading seti çöz ve bir Task 2 yazıp değerlendir; sonuçları not et.", link: "ielts.html#reading", once: true },
            { key: "video", text: "{n} kez: İngilizce bir videoyu Transkript modunda cümle cümle dinle ve gölgele.", link: "video.html", scale: "skill" },
            { key: "dikte", text: "{n} kez: aynı videoda Dikte modunu çöz (yazım ve duyduğunu yakalama).", link: "video.html", scale: "skill" },
            { key: "kelime", text: "Her gün: videolardan en az 8 kelimeyi karta ekle ve bekleyen kartları tekrar et.", link: "kartlar.html" },
            { key: "gramer", text: "{n} videoda Gramer modunu aç; çıkan konulardan zayıf olduklarını not et.", link: "video.html", scale: "light" },
            { key: "tekrar", text: "{n} gramer konusunu tekrar et ve alıştırmasını çöz (Gramer sekmesi).", link: "ielts.html#gramer", scale: "skill" }
        ]
    },
    {
        key: "beceri", name: "Beceri", goal: "Her bölümü sınav biçiminde, süre tutarak çalış; hatalarından öğren.",
        tasks: [
            { key: "reading", text: "{n} Reading seti çöz (süreli); yanlışlarında kanıt paragrafını bul.", link: "ielts.html#reading", scale: "skill" },
            { key: "listening", text: "{n} Listening seti çöz; kaçırdığın cümleleri videoda yeniden dinle.", link: "ielts.html#listening", scale: "skill" },
            { key: "task2", text: "{n} Task 2 yaz (40 dk) ve değerlendir; düzeltmeleri yeniden yaz.", link: "ielts.html#writing", scale: "writing" },
            { key: "task1", text: "1 Task 1 yaz (20 dk) ve değerlendir.", link: "ielts.html#writing" },
            { key: "speaking", text: "{n} Speaking seti: Bölüm 2'yi süre tutarak kaydet, dinle, ölçütlere göre kendini değerlendir.", link: "ielts.html#speaking", scale: "skill" },
            { key: "tekrar", text: "Writing değerlendirmesinde çıkan dil bilgisi hatalarının konusunu Gramer sekmesinde tekrar et.", link: "ielts.html#gramer" },
            { key: "kelime", text: "Her gün: bekleyen kartları tekrar et; bu haftanın yazılarında geçen yeni kelimeleri deftere ekle.", link: "kartlar.html" }
        ]
    },
    {
        key: "deneme", name: "Deneme", goal: "Tam sınav temposu: bölümleri arka arkaya, süreyle çöz; yeni konu açma.",
        tasks: [
            { key: "tam", text: "{n} kez tam çalışma: Listening + Reading + Task 1 + Task 2'yi aynı oturumda, ara vermeden yap.", link: "ielts.html#reading", scale: "light" },
            { key: "hata", text: "Hata defteri: bu haftaki yanlışlarını türüne göre say; en sık üç hatana yoğunlaş.", link: "ielts.html#yol" },
            { key: "speaking", text: "{n} Speaking seti: baştan sona 11–14 dakika, durmadan.", link: "ielts.html#speaking", scale: "skill" },
            { key: "kelime", text: "Her gün: yalnızca tekrar; yeni kart ekleme.", link: "kartlar.html" },
            { key: "taktik", text: "Taktikler sekmesini bir kez daha oku; sınav günü süre planını yaz.", link: "ielts.html#taktik", once: true }
        ]
    }
];

// En zayıf bölüm için her hafta eklenen ek görev
const IELTS_WEAK_TASKS = {
    listening: { text: "Zayıf bölüm (Listening): 2 ek Dikte çalışması; yanlış yazdığın kelimeleri karta ekle.", link: "video.html" },
    reading: { text: "Zayıf bölüm (Reading): 1 ek Reading seti; her yanlış için \"neden yanıldım\" notu yaz.", link: "ielts.html#reading" },
    writing: { text: "Zayıf bölüm (Writing): bu haftaki bir yazını düzeltmelere göre baştan yaz ve yeniden değerlendir.", link: "ielts.html#writing" },
    speaking: { text: "Zayıf bölüm (Speaking): her gün 5 dakika bir Bölüm 1 konusunda sesli konuş ve kaydını dinle.", link: "ielts.html#speaking" }
};

// Gramer tekrarı: IELTS'te (özellikle Writing ve Speaking'in "Grammatical Range and Accuracy" ölçütünde)
// en çok puan getiren ya da kaybettiren konular. "key" sunucudaki GRAMMAR_TOPICS ile aynı olmalı (backend/ielts.py).
const IELTS_GRAMMAR = [
    {
        key: "tenses", title: "Tenses: past, present perfect, present", tr: "Zamanlar",
        why: "Speaking Bölüm 1-2'de geçmiş ve şimdiyi, Academic Task 1'de yıllara göre değişimi anlatırken zaman hatası en sık puan kaybettiren hatadır.",
        pattern: "V2 (bitmiş zaman) · have/has + V3 (şimdiyle bağlantılı) · V1 / V-s (genel doğru)",
        explain: "Belirli, bitmiş bir zamanı söylüyorsan (in 2010, last year) Past Simple kullan. Zaman belirtmiyorsan ya da etkisi sürüyorsa (since, for, recently, so far) Present Perfect kullan. Genel doğrular ve alışkanlıklar için Present Simple.",
        examples: ["The number of students rose sharply in 2015.", "Unemployment has fallen since 2020.", "Most people in my city commute by bus."],
        wrong: "I have visited London last year.", right: "I visited London last year."
    },
    {
        key: "articles", title: "Articles: a / an / the / zero article", tr: "Artikeller",
        why: "Türkçede artikel olmadığı için Türk adayların en sık yaptığı hata budur; Writing'de neredeyse her cümlede karşına çıkar.",
        pattern: "a/an + tekil sayılabilir (ilk kez) · the + bilinen/tek olan · artikel yok + genel çoğul ya da sayılamayan",
        explain: "Tekil sayılabilir bir isim tek başına duramaz: a, an, the ya da my/this gibi bir belirleyici ister. Genel konuşurken çoğul ve sayılamayan isimler artikelsiz kullanılır (Technology changes lives). İkinci kez söz ettiğin ya da tek olan şey için the kullanılır.",
        examples: ["Governments should invest in public transport.", "The government of my country built a new airport.", "The internet has changed the way people work."],
        wrong: "Internet is useful tool for the students.", right: "The internet is a useful tool for students."
    },
    {
        key: "agreement", title: "Subject–verb agreement", tr: "Özne–fiil uyumu",
        why: "Basit ama çok görünür bir hata: sık yapılırsa dil bilgisi puanı 6'nın üstüne çıkmaz.",
        pattern: "tekil özne + V-s / is / has · çoğul özne + V1 / are / have",
        explain: "Fiil, öznenin asıl kelimesine uyar; aradaki kelimelere değil (The number of cars IS rising). people, police çoğuldur; everyone, each, the number of tekildir; a number of çoğuldur.",
        examples: ["The number of tourists has increased.", "A number of studies show the opposite.", "Everyone agrees that education is important."],
        wrong: "Many people thinks that technology make life easier.", right: "Many people think that technology makes life easier."
    },
    {
        key: "countable", title: "Countable and uncountable nouns", tr: "Sayılabilen ve sayılamayan isimler",
        why: "information, advice, research gibi kelimeler Writing Task 2'de çok geçer ve çoğul yapılırsa hemen göze batar.",
        pattern: "many / few / a number of + çoğul · much / little / an amount of + sayılamayan",
        explain: "Sayılamayan isimler çoğul olmaz ve a/an almaz: information, advice, research, knowledge, equipment, furniture, traffic, pollution, evidence, progress. Saymak istersen: a piece of advice, two pieces of research.",
        examples: ["There is a great deal of evidence for this.", "Fewer people smoke today, and there is less pollution.", "She gave me a useful piece of advice."],
        wrong: "Students can find many informations and advices online.", right: "Students can find a lot of information and advice online."
    },
    {
        key: "complex", title: "Complex sentences: although, while, because, whereas", tr: "Bileşik cümleler",
        why: "Bant 7 için \"çeşitli bileşik yapılar\" beklenir. Yalnızca kısa basit cümlelerle yazan aday 5-6 bandında kalır.",
        pattern: "Although / While + cümle, cümle · cümle + because / whereas / so that + cümle",
        explain: "İki fikri tek cümlede bağla: karşıtlık için although, while, whereas; neden için because, since, as; amaç için so that; koşul için if, unless. Although ile but aynı cümlede birlikte kullanılmaz.",
        examples: ["Although cities offer more jobs, many people prefer rural life.", "Sales rose in Europe, whereas they fell in Asia.", "Governments tax fuel so that people drive less."],
        wrong: "Although it is expensive, but many people buy it.", right: "Although it is expensive, many people buy it."
    },
    {
        key: "relative", title: "Relative clauses: who, which, that, where", tr: "Sıfat cümlecikleri",
        why: "Bir ismi tek cümlede tanımlamanı sağlar; Speaking Bölüm 2'de kişi, yer ve nesne anlatırken sürekli gerekir.",
        pattern: "isim + who / which / that / where / whose + cümlecik",
        explain: "İnsanlar için who, nesneler için which ya da that, yerler için where, sahiplik için whose. Sıfat cümleciğinde ismi zamirle ikinci kez söyleme (which I bought it değil). Virgüllü (ek bilgi veren) cümlecikte that kullanılmaz.",
        examples: ["People who work from home save time.", "The town where I grew up has changed a lot.", "Tourism, which employs millions, is growing fast."],
        wrong: "The book which I read it last month was interesting.", right: "The book which I read last month was interesting."
    },
    {
        key: "conditionals", title: "Conditionals", tr: "Koşul cümleleri",
        why: "Task 2'de sonuç ve öneri anlatmanın, Speaking Bölüm 3'te varsayım yapmanın ana yoludur.",
        pattern: "If + present, will + V1 (gerçek) · If + past, would + V1 (varsayım) · If + had V3, would have V3 (geçmişte olmamış)",
        explain: "Gerçekleşebilir bir durum için birinci tip; hayali ya da pek olası olmayan bir durum için ikinci tip; geçmişte olmamış bir şey için üçüncü tip. If'li yan cümlede will ya da would kullanılmaz.",
        examples: ["If governments invest in railways, traffic will decrease.", "If I had more free time, I would learn another language.", "If the city had planned better, the problem would not have appeared."],
        wrong: "If people will use public transport, pollution will fall.", right: "If people use public transport, pollution will fall."
    },
    {
        key: "passive", title: "Passive voice", tr: "Edilgen yapı",
        why: "Academic Task 1'de süreç (process) anlatımının temelidir; Task 2'de de resmi bir ton verir.",
        pattern: "be + V3 (is made, was built, has been reduced, will be completed, can be seen)",
        explain: "İşi kimin yaptığı önemli değilse ya da bilinmiyorsa edilgen yapı kullan. Zamanı be fiili gösterir, asıl fiil hep üçüncü hâlde kalır. Geçişsiz fiiller (happen, rise, fall) edilgen yapılmaz.",
        examples: ["The beans are dried and then roasted.", "A new bridge was built in 2019.", "It is widely believed that exercise improves memory."],
        wrong: "The accident was happened last night.", right: "The accident happened last night."
    },
    {
        key: "comparatives", title: "Comparatives and superlatives", tr: "Karşılaştırma",
        why: "Academic Task 1'in özü karşılaştırmadır; Speaking'de de \"geçmişle bugünü karşılaştır\" soruları çok sorulur.",
        pattern: "-er than / more … than · the -est / the most … · as … as · twice as … as",
        explain: "Kısa sıfatlar -er / -est, uzun sıfatlar more / most alır; ikisi birlikte kullanılmaz. Farkı güçlendirmek için much, far, slightly, considerably ekle. Eşitlik için as … as.",
        examples: ["Rents in the capital are far higher than in other cities.", "Germany was the largest exporter of the three.", "The figure for 2020 was twice as high as in 2010."],
        wrong: "Life in cities is more easier than villages.", right: "Life in cities is easier than in villages."
    },
    {
        key: "modals", title: "Modal verbs and hedging", tr: "Kipler ve temkinli ifade",
        why: "Akademik yazıda kesin konuşmak yerine temkinli konuşmak beklenir; aşırı genelleme Task Response puanını düşürür.",
        pattern: "may / might / could + V1 · tend to + V1 · be likely to + V1 · should / must + V1",
        explain: "Kanıtlayamayacağın şeyi kesinmiş gibi yazma: \"This will cause…\" yerine \"This may lead to…\". Öneri için should, zorunluluk için must / have to. Kiplerden sonra fiil yalın gelir; to ya da -s almaz.",
        examples: ["Higher taxes may discourage people from driving.", "Young people tend to spend more time online.", "This is likely to reduce costs in the long term."],
        wrong: "Governments should to ban cars; this will solves the problem.", right: "Governments should restrict cars; this could reduce the problem."
    },
    {
        key: "prepositions", title: "Prepositions and trend language", tr: "Edatlar ve eğilim dili",
        why: "Task 1'de sayıları anlatırken edat hatası anlamı değiştirir: \"rose to 20\" ile \"rose by 20\" aynı şey değildir.",
        pattern: "rise to (varılan değer) · rise by (fark) · a rise of (isimle) · in + yıl/ay · at + sayı · from … to …",
        explain: "to varılan noktayı, by değişim miktarını gösterir; isimden sonra of ve in gelir (a rise of 5% in prices). Sık geçen kalıplar: depend on, interested in, responsible for, the reason for, an increase in.",
        examples: ["Sales rose from 10 million to 15 million.", "Prices increased by 5% in 2021.", "There was a sharp fall in the number of visitors."],
        wrong: "The price increased with 10% at 2020.", right: "The price increased by 10% in 2020."
    },
    {
        key: "gerunds", title: "Gerunds and infinitives", tr: "Fiilimsi: -ing ve to + fiil",
        why: "Fiilden sonra gelen yapıyı karıştırmak hem Writing'de hem Speaking'de sık görülen, kolay düzeltilen bir hatadır.",
        pattern: "enjoy / avoid / suggest / consider + V-ing · want / decide / need / tend + to V1 · edat + V-ing",
        explain: "Bazı fiiller -ing, bazıları to ister; ezberlemek gerekir. Edatlardan sonra her zaman -ing gelir (instead of driving, interested in learning). Cümlenin öznesi olarak -ing kullanılır (Learning a language takes time).",
        examples: ["Many people avoid using public transport.", "The government decided to raise taxes.", "Recycling waste reduces the need for new materials."],
        wrong: "I am interested to learn English and I enjoy to read.", right: "I am interested in learning English and I enjoy reading."
    }
];
