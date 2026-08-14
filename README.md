# openpick — kanıtlanabilir adil X çekilişleri

Retweet/beğeni toplayıp çekiliş yapan ve sonucu **herkesin bağımsız doğrulayabileceği**
şekilde yayınlayan araç. Rakiplerden farkı: "adil" demekle kalmaz, kanıtını gösterir.

Site: **https://kek0000-cybe.github.io/openpick**

## Neden kanıtlanabilir adil?

İki şeyi aynı anda garanti ediyoruz:

1. **Liste sonradan değiştirilemez.** Katılım kapanınca listenin SHA-256 özeti tweetlenir.
   Tek bir kişi eklense veya çıkarılsa özet tamamen değişir — herkes fark eder.
2. **Sonucu kimse önceden bilemez, sen dahil.** Tohum, önceden ilan edilen ama henüz
   kazılmamış bir Bitcoin bloğunun hash'i. O blok gelecekte olduğu için kimse bilemez,
   kimse etkileyemez.

İkisi birleşince aradaki boşluk kapanır: liste kilitlendiğinde sonuç belli değildir,
sonuç belli olduğunda liste artık değiştirilemez.

Geri sayım bitince ziyaretçinin tarayıcısı blok hash'ini doğrudan Bitcoin ağından çekip
kazananları kendisi hesaplar — biz hiçbir şey yayınlamadan önce. Herkes aynı anda,
birbirinden bağımsız, aynı sonucu bulur.

### Rastgelelik nereden geliyor?

Varsayılan kaynak **drand** (League of Entropy): dağıtık bir eşik imza ağının her
**3 saniyede** bir ürettiği, herkesin doğrulayabildiği rastgele değer. Tur numarası
zamandan kesin hesaplanır, yani "şu saatte şu tur kullanılacak" önceden ilan edilebilir;
ama o turun değeri zamanı gelmeden üretilmez. Sonuç neredeyse anında gelir ve garanti
bozulmaz.

Bitcoin bloğu da kullanılabilir (`--source bitcoin`) ama blok aralığı ~10 dakika
olduğu için çekiliş çok daha uzun sürer.

### Bitcoin kullanırken: neden blok yüksekliği, saat değil?

Taahhüt "şu saatten sonraki ilk blok" değil, **belirli bir blok numarası** olarak verilir.
Bitcoin blok zaman damgaları monotonik değildir ve kısmen madenci kontrolündedir; saat
tabanlı bir kural hem oynatılabilir olurdu hem de doğrulayanın "hangi blok?" sorusunu bir
API'ye sormasını gerektirirdi. Yükseklik ise kesindir ve herhangi bir blok gezgininden
teyit edilebilir. Sitedeki geri sayım yalnızca sunum içindir; sonuca hiçbir etkisi yoktur.

## Kurulum

```bash
npm install
npx playwright install chromium
```

## En kolay yol: çift tıkla

Klasördeki **`Cekilis Paneli.bat`** dosyasına çift tıkla. Panel açılır, tarayıcı
kendiliğinden gelir. Komut yazmana gerek yok.

Panelde: tweet linkini yapıştır → filtreleri seç → **Çekilişi otomatik tamamla**.
Gerisi kendiliğinden olur — taahhüt verilir, rastgelelik beklenir, çekiliş yapılır
ve sonuç siteye gönderilir.

Terminalden açmak istersen: `npm run panel` (`http://localhost:8090`)

Panel yalnızca `127.0.0.1` üzerinden erişilebilir, yani ağdaki başka bir cihaz açamaz.
Çalıştırabildiği komutlar sabit bir listede ve argümanlar dizi olarak geçirilir (kabuk
kullanılmaz), dolayısıyla komut enjeksiyonu mümkün değildir. Herkese açık siteye dahil
edilmez.

Aşağıdaki komutlar aynı işi terminalden yapar; panel sadece bunları çağırır.

## Çekiliş akışı (komut satırı)

### 1. Bir kereliğine giriş

```bash
npm run login
```

Açılan tarayıcıda X hesabınla giriş yap, sonra pencereyi kapat. Oturum `.session/`
klasöründe kalır — şifren hiçbir yere yazılmaz.

### 2. Katılımcıları topla

```bash
npm run collect -- --url https://x.com/kullanici/status/123456 --types retweets,likes
```

`--max 5000` üst sınır, `--slow` daha güvenli tempo. Uzun süren çekilişlerde arada bir
tekrar çalıştır; yeni katılımcılar eklenir, tekrarlar ayıklanır.

### 3. Katılımı kapat ve taahhüt et

```bash
npm run commit -- --tweet 123456 --draw-at 2026-08-20T21:00:00+03:00 --title "Çekiliş" --prize "PS5" --min-tweets 100 --min-age-days 30
```

Komut sana hazır bir tweet metni verir. **Onu yayınla** — kanıtın belkemiği bu adım.
Tweeti attıktan sonra linkini kaydet:

```bash
npm run commit -- --tweet 123456 --commit-tweet https://x.com/sen/status/999 --draw-at ... (aynı ayarlarla)
```

### 4. Çekilişi yap

Otomatik (rastgeleliği bekler, çeker, yayınlar, siteye gönderir):

```bash
npm run watch -- --tweet 123456 --winners 3 --backups 2 --push
```

Ya da elle:

```bash
npm run draw -- --tweet 123456 --winners 3 --backups 2
```

### 5. Siteye yayınla

```bash
npm run publish -- --tweet 123456
npm run site          # önce yerelde kontrol et
git add -A && git commit -m "çekiliş" && git push
```

## Testler

```bash
npm run check      # tüm testler
npm test           # birim testleri + iki motorun eşitliği
npm run crosscheck # yayınlanan sayfalar Node motoruyla aynı mı
npm run fixtures   # gerçek çekiliş beklemeden örnek veri üret
```

`npm test` içindeki ki-kare testi 70.000 çekiliş yapıp dağılımın dengeli olduğunu
doğrular. Modulo yanlılığı reddetme örneklemesiyle engellenir. `crosscheck`, kripto
motorunun sayfalara gömülmesi sırasında bir şey bozulursa yakalar — komut satırı ile
sitenin farklı kazanan göstermesi mümkün olmamalı.

## Bilmen gereken riskler

Toplama adımı X'in resmî API'sini değil, giriş yapmış tarayıcı oturumunu kullanıyor:

- **Hesap askıya alınabilir.** Bu yöntem X kullanım şartlarına aykırı. Ana hesabın yerine
  ayrı bir hesap kullanman daha güvenli olur.
- **Kırılgan.** X iç yapısını değiştirdiğinde toplama bozulabilir. Kod sabit uç nokta
  kimliği yazmaz, sayfanın kendi isteklerini dinler — ama garanti değil.
- **Ölçek sınırlı.** Çok büyük veya çok sık çekilişte hız sınırına takılırsın. `--slow` kullan.

Site tarafı X'e hiç dokunmaz; risk yalnızca yerel `collect` adımındadır. Sonradan resmî
API'ye geçmek istersen sadece `src/collect.js` değişir.

## Asla paylaşma

`.session/` klasörü hesabına tam erişim veren token'ları içerir. `.gitignore` bunu
dışarıda tutar — o satırı silme. `/data/` de tamamen dışarıdadır; yayınlanacak dosyalar
oradan değil, `publish.js` aracılığıyla seçilerek `docs/` altına kopyalanır.

`.gitattributes` satır sonlarını LF'te sabitler. Bu dosyayı da silme: Windows'ta git
satır sonlarını değiştirirse `katilimcilar.txt`'nin özeti bozulur ve dürüst bir
doğrulayıcı bizim hile yaptığımız sonucuna varır.

## Yapı

| Dosya | İşi |
|---|---|
| `src/collect.js` | Tarayıcı üzerinden katılımcı toplama |
| `src/filters.js` | Bot/spam filtreleri |
| `src/fairness.js` | Taahhüt, tohum, tarafsız kazanan seçimi (Node) |
| `web/lib/engine.js` | Aynı motorun tarayıcı sürümü |
| `web/lib/chain.js` | Bitcoin blok sorgulama (Node ve tarayıcı ortak) |
| `src/commit.js` | Katılımı kapatır, taahhüt metnini üretir |
| `src/draw.js` | Blok hash'ini alır, kazananları belirler |
| `src/publish.js` | `docs/` altındaki statik siteyi üretir |
| `src/panel.js` | Yerel yönetim paneli sunucusu (sadece 127.0.0.1) |
| `web/assets/site.css` | 6Q Community tasarım sistemi tokenları |
| `web/templates/` | Sayfa şablonları — tasarımı buradan düzenle |
| `docs/` | Üretilen site — elle düzenleme, `web/` altını düzenle |
