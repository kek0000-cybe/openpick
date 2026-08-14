import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as node from '../src/fairness.js';
import * as web from '../web/lib/engine.js';

/**
 * İki motor birebir aynı sonucu vermeli. Ayrışırlarsa site ile komut satırı
 * farklı kazanan gösterir ve ürünün tüm değeri yok olur.
 * Node 24'te crypto.subtle global olduğu için tarayıcı açmadan test edilebiliyor.
 */
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pool = (n) => Array.from({ length: n }, (_, i) => `kullanici_${i}`);

test('canonicalize aynı', () => {
  const inputs = [
    ['Ali', '@veli', 'AYSE', 'ali'],
    ['  bosluklu  ', 'x'],
    ['tek'],
  ];
  for (const inp of inputs) assert.equal(node.canonicalize(inp), web.canonicalize(inp));
});

test('commitHash aynı', async () => {
  for (const n of [1, 2, 7, 100, 999]) {
    assert.equal(node.commitHash(pool(n)), await web.commitHash(pool(n)));
  }
});

test('deriveSeed aynı', async () => {
  for (let i = 0; i < 20; i++) {
    const c = hash(`c${i}`);
    const b = hash(`b${i}`);
    assert.equal(node.deriveSeed(c, b), await web.deriveSeed(c, b));
  }
});

test('drawIndexDetailed aynı — 300 rastgele kombinasyon', async () => {
  for (let i = 0; i < 300; i++) {
    const seed = hash(`seed-${i}`);
    const counter = i % 17;
    const bound = 1 + (i * 7919) % 5000;
    const a = node.drawIndexDetailed(seed, counter, bound);
    const b = await web.drawIndexDetailed(await web.seedKey(seed), counter, bound);
    assert.deepEqual(a, b, `seed=${seed.slice(0, 8)} counter=${counter} bound=${bound}`);
  }
});

test('runDraw tamamen aynı — kazananlar, yedekler, tohum ve adımlar', async () => {
  const cases = [
    { n: 1, w: 1, b: 0 },
    { n: 3, w: 1, b: 0 },
    { n: 7, w: 3, b: 2 },
    { n: 100, w: 5, b: 3 },
    { n: 2500, w: 10, b: 5 },
  ];
  for (const [i, c] of cases.entries()) {
    const handles = pool(c.n);
    const blockHash = hash(`blok-${i}`);
    const a = node.runDraw({ handles, blockHash, winnerCount: c.w, backupCount: c.b });
    const bb = await web.runDraw({ handles, blockHash, winnerCount: c.w, backupCount: c.b });
    assert.equal(a.commit, bb.commit, 'taahhüt');
    assert.equal(a.seed, bb.seed, 'tohum');
    assert.deepEqual(a.winners, bb.winners, 'kazananlar');
    assert.deepEqual(a.backups, bb.backups, 'yedekler');
    assert.deepEqual(a.steps, bb.steps, 'adımlar');
  }
});

test('taahhüt uyuşmazlığı iki motorda da reddedilir', async () => {
  const handles = pool(10);
  const commit = node.commitHash(handles);
  const blockHash = hash('x');
  assert.throws(() => node.runDraw({ handles: [...handles, 'sahte'], blockHash, commit }));
  await assert.rejects(() => web.runDraw({ handles: [...handles, 'sahte'], blockHash, commit }));
});
