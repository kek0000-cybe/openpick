/**
 * Yorumdan katilimci kimligi cikarimi.
 *
 * Insanlar serbest yaziyor:
 *   "Katildim id ::::Firat27"   "fes23 katildim"   "Id: kanboz121820gma"
 *   "user name 6q : virguest"   "Nickim:fenerliamca1907 multi degilim"
 *
 * Bu yuzden sonuc TAHMINDIR. Ham metin her zaman yaninda saklanir ve dusuk
 * guvenli tahminler isaretlenir; cekilis oncesi gozle kontrol edilebilsin diye.
 */

// "id", "nick", "username" gibi etiket sozcukleri. Degerin bunlarin ARDINDAN
// gelmesi en guvenilir sinyal: kisi kimligini bilerek isaretlemis demektir.
// Deger hemen bitisik olmayabilir ("user name 6q : virguest"), o yuzden
// etiketten sonra ilk ANLAMLI kelimeye kadar ilerleniyor.
// ⚠️ \b KULLANILMIYOR: JavaScript'te \b yalnizca ASCII harfleri tanir, yani
//    "İd:" yazan biri icin kelime siniri olusmuyor ve etiket kacirilıyordu.
//    Sinir, Turkce harfleri de iceren acik bir karakter kumesiyle tanimli.
const HARF = 'A-Za-z0-9_çğıöşüÇĞİÖŞÜ';
const ETIKET = new RegExp(
  `(?:kullan[iı]c[iı]\\s*ad[iı]m?|user\\s*name|username|nick(?:name|im)?|is[iı]m|(?<![${HARF}])[iıİI]d(?![${HARF}]))`,
  'i',
);
const AYIRAC = new RegExp(`[^${HARF}.]+`);

// Etiket sozcukleri ve sik gecen nezaket kelimeleri aday olamaz.
const ETIKET_SOZCUK = /^(kat[iı]ld[iı]m|id|nick|nickim|nickname|username|user|name|6q|6qnet|thanks|thankyou|site|hesap|hesab[iı]m|is[iı]m|bol|sans|sanslar|[sş]ans|[sş]anslar|g[uü]zel|sa[gğ]lam|s[uü]per|harika|c[uü]mleten|bakal[iı]m|iyi|varsin|vars[iı]n)$/i;

export function kimlikTahmini(metin) {
  const ham = String(metin ?? '')
    .replace(/@[A-Za-z0-9_]+/g, ' ')                                   // etiketlenen hesaplar
    .replace(/https?:\/\/\S+/g, ' ')                                   // linkler
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' '); // emoji

  // Bastaki/sondaki noktalama temizlenir: "katildim." tek parca olarak gelip
  // etiket sozcugu kontrolunu atlatiyordu.
  const sadelestir = (p) => p.replace(/^[._]+|[._]+$/g, '');
  const uygun = (p) => p.length >= 3 && /[A-Za-z0-9]/.test(p) && !ETIKET_SOZCUK.test(p);
  const parcala = (metin) => metin.split(AYIRAC).map(sadelestir).filter(uygun);

  const etiket = ham.match(ETIKET);
  if (etiket) {
    const sonrasi = ham.slice(etiket.index + etiket[0].length);
    const [ilk] = parcala(sonrasi);
    if (ilk) return { id: ilk.slice(0, 30), kesin: true };
  }

  // Etiket yoksa tahmin zayiftir: kisi sadece "guzel site" yazmis da olabilir.
  const adaylar = parcala(ham);
  if (adaylar.length === 0) return { id: null, kesin: false };

  // Gercek kimlikler cogunlukla rakam tasir ("fes23", "913frc", "Huso41").
  // Rakamli aday varsa onu sec; yoksa en uzunu.
  const rakamli = adaylar.filter((p) => /[0-9]/.test(p));
  const havuz = rakamli.length ? rakamli : adaylar;
  havuz.sort((a, b) => b.length - a.length);
  const secilen = havuz[0];

  // Rakamsiz ve cok kisa bir kelime kimlik olmaktan cok siradan bir sozcuktur
  // ("Cok", "Iyi"). Yanlis kimlik yazmaktansa bos birakmak dogru.
  if (!/[0-9]/.test(secilen) && secilen.length < 4) return { id: null, kesin: false };
  return { id: secilen.slice(0, 30), kesin: false };
}
