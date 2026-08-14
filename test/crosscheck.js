import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runDraw } from '../src/fairness.js';
import { ROOT, readJson } from '../src/paths.js';

/**
 * YAYINLANMIS sayfalari test eder, kaynak dosyalari degil.
 * publish.js kripto motorunu sayfalara satir ici gomuyor; gomme adimi bozulursa
 * kaynak testleri gecer ama site yanlis kazanan gosterir. Buradaki testler
 * tam olarak o bosluga bakar.
 *
 * Motorlarin matematiksel esitligi ayrica test/parity.test.js icinde
 * tarayici acmadan dogrulanir.
 */
const DOCS = path.join(ROOT, 'docs');
const verifyPage = path.join(DOCS, 'dogrula', 'index.html');

if (!fs.existsSync(verifyPage)) {
  console.error('\n  docs/ uretilmemis. Once: npm run fixtures && npm run publish\n');
  process.exit(1);
}

const CASES = [
  { n: 3, winners: 1, backups: 0 },
  { n: 7, winners: 3, backups: 2 },
  { n: 180, winners: 3, backups: 2 },
  { n: 1500, winners: 10, backups: 5 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
let failures = 0;

/* --- 1) Yayinlanmis dogrulama sayfasi, Node motoruyla ayni mi --- */
await page.goto(pathToFileURL(verifyPage).href);

for (const [idx, c] of CASES.entries()) {
  const handles = Array.from({ length: c.n }, (_, i) => `kullanici_${i}`);
  const blockHash = crypto.createHash('sha256').update(`blok-${idx}`).digest('hex');
  const node = runDraw({ handles, blockHash, winnerCount: c.winners, backupCount: c.backups });

  await page.fill('#list', handles.join('\n'));
  await page.fill('#block', blockHash);
  await page.fill('#winners', String(c.winners));
  await page.fill('#backups', String(c.backups));
  await page.click('#run');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#o-winners .kazanan-ad').length === n, c.winners);

  const web = await page.evaluate(() => ({
    commit: document.getElementById('o-commit').textContent,
    seed: document.getElementById('o-seed').textContent,
    winners: [...document.querySelectorAll('#o-winners .kazanan-ad')].map((e) => e.textContent.slice(1)),
    backups: [...document.querySelectorAll('#o-backups .kazanan-ad')].map((e) => e.textContent.slice(1)),
  }));

  const same = web.commit === node.commit && web.seed === node.seed &&
    JSON.stringify(web.winners) === JSON.stringify(node.winners) &&
    JSON.stringify(web.backups) === JSON.stringify(node.backups);

  console.log(`  ${same ? 'ESLESTI ' : 'AYRISTI '} dogrulama sayfasi  n=${String(c.n).padEnd(5)} kazanan=${c.winners}`);
  if (!same) {
    failures++;
    console.log('    node:', node.winners.join(','), '| web:', web.winners.join(','));
  }
}

/* --- 2) Yayinlanmis cekilis sayfalari sonucu dogru gosteriyor mu --- */
for (const entry of fs.readdirSync(DOCS, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[0-9]{5,25}$/.test(entry.name)) continue;
  const meta = readJson(path.join(DOCS, entry.name, 'cekilis.json'));
  if (!meta?.bitcoin?.blockHash) continue;

  await page.goto(pathToFileURL(path.join(DOCS, entry.name, 'index.html')).href);
  await page.waitForFunction(
    (n) => document.querySelectorAll('#winners .kazanan-ad').length === n, meta.winners.length);

  const shown = await page.evaluate(() => ({
    winners: [...document.querySelectorAll('#winners .kazanan-ad')].map((e) => e.textContent.slice(1)),
    seed: document.getElementById('f-seed').textContent,
    // Her tur sayfada yeniden hesaplanip kayitla karsilastiriliyor;
    // bir tanesi bile uyusmazsa uyari sinifi basilir.
    badSteps: document.querySelectorAll('#steps .uyari.kotu').length,
  }));

  const listFile = path.join(DOCS, entry.name, 'katilimcilar.txt');
  const handles = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
  const node = runDraw({
    handles, blockHash: meta.bitcoin.blockHash,
    winnerCount: meta.winners.length, backupCount: meta.backups.length, commit: meta.commit,
  });

  const same = JSON.stringify(shown.winners) === JSON.stringify(node.winners) &&
    shown.seed === node.seed && shown.badSteps === 0;
  console.log(`  ${same ? 'ESLESTI ' : 'AYRISTI '} cekilis sayfasi     ${entry.name}`);
  if (!same) {
    failures++;
    console.log('    node:', node.winners.join(','), '| sayfa:', shown.winners.join(','),
      '| hatali adim:', shown.badSteps);
  }
}

await browser.close();
console.log(failures === 0
  ? '\n  Yayinlanan sayfalar Node motoruyla birebir ayni sonucu veriyor.\n'
  : `\n  ${failures} durumda ayrisma var.\n`);
process.exit(failures === 0 ? 0 : 1);
