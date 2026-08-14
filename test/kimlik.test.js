import test from 'node:test';
import assert from 'node:assert/strict';
import { kimlikTahmini } from '../src/kimlik.js';

/**
 * Ornekler GERCEK bir cekilisin yanitlarindan alindi
 * (SixQnetofficial, 2085146286513119718). Uydurma degil, sahada gorulen bicimler.
 */

test('etiketli kimlikler guvenilir cikarilir', () => {
  const durumlar = [
    ['@SixQnetofficial Katıldım id ::::Firat27', 'Firat27'],
    ['@SixQnetofficial Id: kanboz121820gma\nKatıldım', 'kanboz121820gma'],
    ['@SixQnetofficial Id: Sefakznc', 'Sefakznc'],
    ['@SixQnetofficial user name 6q : virguest', 'virguest'],
    ['@SixQnetofficial Nickim:fenerliamca1907 multi değilim efendim', 'fenerliamca1907'],
    ['@SixQnetofficial ID:Huso41 Katıldım .....', 'Huso41'],
    ['@SixQnetofficial İd: R2D2 katıldım', 'R2D2'],
    ['@SixQnetofficial Username : ExpertPlayer', 'ExpertPlayer'],
    ['@SixQnetofficial ID define Katildim', 'define'],
    ['@SixQnetofficial İd Fakir34 thanks 6q', 'Fakir34'],
    ['@SixQnetofficial Id hayvansal', 'hayvansal'],
  ];
  for (const [metin, beklenen] of durumlar) {
    const r = kimlikTahmini(metin);
    assert.equal(r.id, beklenen, metin);
    assert.equal(r.kesin, true, `guvenilir olmali: ${metin}`);
  }
});

test('etiketsiz yazilanlar zayif tahmin olarak isaretlenir', () => {
  const r = kimlikTahmini('@SixQnetofficial fes23 katıldım');
  assert.equal(r.id, 'fes23');
  assert.equal(r.kesin, false, 'etiket yoksa kesin sayilmamali');
});

test('kimlik icermeyen yorumlar yanlis kimlik uretmez', () => {
  // Bunlar sadece yorum; kimlik vermemisler. Onceki surum "site", "anslar"
  // gibi rastgele kelimeleri kimlik sanip listeye yaziyordu.
  for (const metin of ['@SixQnetofficial Sağlam site', '@SixQnetofficial Çok güzel site']) {
    const r = kimlikTahmini(metin);
    assert.equal(r.kesin, false, metin);
    assert.notEqual(r.id, 'site', `nezaket sozcugu kimlik sayilmamali: ${metin}`);
  }
});

test('rakam tasiyan aday tercih edilir', () => {
  // "katildim." sondaki nokta yuzunden etiket kontrolunu atlatip secilmisti.
  const r = kimlikTahmini('@SixQnetofficial katıldım. 913frc');
  assert.equal(r.id, '913frc');
});

test('kimlik olmayan kisa sozcukler bos birakilir', () => {
  // Yanlis kimlik yazmaktansa bos birakmak dogru.
  for (const metin of ['@SixQnetofficial Çok güzel site', '@SixQnetofficial İyi ki varsin 6q']) {
    assert.equal(kimlikTahmini(metin).id, null, metin);
  }
});

test('emoji ve bos yorumdan kimlik cikmaz', () => {
  assert.equal(kimlikTahmini('@SixQnetofficial ♥️♥️').id, null);
  assert.equal(kimlikTahmini('').id, null);
  assert.equal(kimlikTahmini(null).id, null);
});

test('link ve etiketlenen hesaplar kimlik sayilmaz', () => {
  const r = kimlikTahmini('@SixQnetofficial @arkadasim bak https://ornek.com/sayfa');
  assert.notEqual(r.id, 'arkadasim');
  assert.ok(!String(r.id ?? '').includes('ornek.com'));
});

test('turkce harfler kelimeyi bolmez', () => {
  // Onceki surum "sanslar" gibi parcalar uretiyordu.
  const r = kimlikTahmini('@SixQnetofficial Bol şanslar cümleten');
  assert.equal(r.kesin, false);
  assert.notEqual(r.id, 'anslar');
});
