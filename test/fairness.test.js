import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, commitHash, deriveSeed, drawIndex, selectWinners, runDraw } from '../src/fairness.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const pool = (n) => Array.from({ length: n }, (_, i) => `user${i}`);

test('liste ozeti siralamadan ve buyuk/kucuk harften bagimsiz', () => {
  const a = commitHash(['Ali', 'veli', '@Ayse']);
  const b = commitHash(['ayse', 'ALI', 'Veli']);
  assert.equal(a, b);
});

test('liste ozeti tek kisi degisince degisir', () => {
  assert.notEqual(commitHash(['ali', 'veli']), commitHash(['ali', 'veli', 'ayse']));
});

test('tekrar eden katilimcilar teke iner', () => {
  assert.equal(canonicalize(['ali', 'ALI', '@ali']), 'ali');
});

test('tohum her iki girdiye de bagli', () => {
  const s1 = deriveSeed(HASH_A, HASH_B);
  assert.notEqual(s1, deriveSeed(HASH_B, HASH_A));
  assert.equal(s1, deriveSeed(HASH_A, HASH_B));
});

test('gecersiz hash reddedilir', () => {
  assert.throws(() => deriveSeed('kisa', HASH_B));
});

test('ayni girdi her zaman ayni kazanani verir', () => {
  const p = pool(500);
  const r1 = runDraw({ handles: p, blockHash: HASH_B, winnerCount: 5 });
  const r2 = runDraw({ handles: p, blockHash: HASH_B, winnerCount: 5 });
  assert.deepEqual(r1.winners, r2.winners);
});

test('farkli blok hash farkli sonuc verir', () => {
  const p = pool(500);
  const r1 = runDraw({ handles: p, blockHash: HASH_A, winnerCount: 5 });
  const r2 = runDraw({ handles: p, blockHash: HASH_B, winnerCount: 5 });
  assert.notDeepEqual(r1.winners, r2.winners);
});

test('kazananlar birbirini tekrar etmez', () => {
  const { winners, backups } = selectWinners(pool(50), deriveSeed(HASH_A, HASH_B), 10, 10);
  const all = [...winners, ...backups];
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 20);
});

test('kazanan sayisi katilimci sayisini asamaz', () => {
  const { winners } = selectWinners(pool(3), deriveSeed(HASH_A, HASH_B), 10);
  assert.equal(winners.length, 3);
});

test('degistirilmis liste taahhutle uyusmaz', () => {
  const p = pool(10);
  const commit = commitHash(p);
  assert.throws(() => runDraw({ handles: [...p, 'sahte'], blockHash: HASH_B, commit }), /uyusmuyor/);
});

test('drawIndex sinirlar icinde kalir', () => {
  for (let bound = 1; bound <= 40; bound++) {
    for (let c = 0; c < 40; c++) {
      const v = drawIndex(deriveSeed(HASH_A, HASH_B), c, bound);
      assert.ok(Number.isInteger(v) && v >= 0 && v < bound, `bound=${bound} v=${v}`);
    }
  }
});

test('secim tarafsiz: 7 kisilik havuzda 70k cekilis dengeli dagilir', () => {
  const n = 7;
  const p = pool(n);
  const trials = 70_000;
  const counts = Object.fromEntries(p.map((h) => [h, 0]));
  for (let i = 0; i < trials; i++) {
    const blockHash = Buffer.from(`blok-${i}`.padEnd(32, '0')).toString('hex');
    const { winners } = runDraw({ handles: p, blockHash, winnerCount: 1 });
    counts[winners[0]]++;
  }
  const expected = trials / n;
  // Ki-kare uyum testi, 6 serbestlik derecesi, %99.9 kritik deger = 22.46
  const chi2 = Object.values(counts).reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 22.46, `ki-kare ${chi2.toFixed(2)} cok yuksek: dagilim dengesiz. ${JSON.stringify(counts)}`);
});

test('modulo yanliligi yok: 3 kisilik havuzda hicbiri avantajli degil', () => {
  const p = pool(3);
  const trials = 30_000;
  const counts = Object.fromEntries(p.map((h) => [h, 0]));
  for (let i = 0; i < trials; i++) {
    const blockHash = Buffer.from(`t-${i}`.padEnd(32, 'x')).toString('hex');
    counts[runDraw({ handles: p, blockHash, winnerCount: 1 }).winners[0]]++;
  }
  const expected = trials / 3;
  for (const [handle, count] of Object.entries(counts)) {
    const deviation = Math.abs(count - expected) / expected;
    assert.ok(deviation < 0.05, `${handle} sapmasi %${(deviation * 100).toFixed(1)}`);
  }
});
