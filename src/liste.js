import fs from 'node:fs';
import path from 'node:path';
import { drawDir, readJson } from './paths.js';
import { kimlikTahmini } from './kimlik.js';

/**
 * Yorumlardan toplanan katilimcilarin KIMLIK LISTESINI cikarir.
 *
 * Cikarim tahmindir, bu yuzden liste ham yorum metnini de tasir ve dusuk
 * guvenli satirlar isaretlenir. Cekilis oncesi bunlari gozle kontrol edip
 * duzeltebilirsin; dosyayi Excel'de acip elle degistirmen yeterli.
 */
function parseArgs(argv) {
  const a = { format: 'csv' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--tweet') a.tweetId = argv[++i];
    else if (k === '--format') a.format = argv[++i];
    else if (k === '--only-id') a.onlyId = true;
  }
  if (!a.tweetId) {
    console.error(`
Kullanim: npm run liste -- --tweet <tweetId> [--format csv|txt] [--only-id]

  --format csv   (varsayilan) Excel'de acilabilir tam liste
  --format txt   Yalnizca kimlikler, satir satir
  --only-id      Kimligi cikarilamayanlari listeye alma
`);
    process.exit(1);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const dir = drawDir(args.tweetId);
const data = readJson(path.join(dir, 'participants.json'));
if (!data) {
  console.error(`\n  Katilimci dosyasi yok. Once:
  npm run collect -- --url <tweet-linki> --types replies\n`);
  process.exit(1);
}

const yorumlu = data.users.filter((u) => u.replyText !== undefined);
if (yorumlu.length === 0) {
  console.error(`
  Bu cekilis yorumlardan toplanmamis; kimlik listesi cikarilamaz.
  Yorumlari toplamak icin:
    npm run collect -- --url ${data.tweetUrl} --types replies
`);
  process.exit(1);
}

// Kayitli tahmini kullan; yoksa (eski veri) metinden yeniden hesapla.
const satirlar = yorumlu.map((u) => {
  const t = u.replyId !== undefined ? { id: u.replyId, kesin: u.replyIdKesin } : kimlikTahmini(u.replyText);
  return { handle: u.handle, id: t.id, kesin: Boolean(t.kesin), metin: (u.replyText ?? '').replace(/\s+/g, ' ').trim() };
});

const secilen = args.onlyId ? satirlar.filter((s) => s.id) : satirlar;
secilen.sort((a, b) => Number(b.kesin) - Number(a.kesin) || a.handle.localeCompare(b.handle));

const kacis = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
let cikti;
let dosya;

if (args.format === 'txt') {
  cikti = secilen.map((s) => s.id ?? '').filter(Boolean).join('\n');
  dosya = path.join(dir, 'kimlikler.txt');
} else {
  const basliklar = ['x_hesabi', 'kimlik', 'guven', 'yorum', 'profil'];
  const govde = secilen.map((s) => [
    '@' + s.handle,
    s.id ?? '',
    s.kesin ? 'kesin' : (s.id ? 'SUPHELI' : 'KIMLIK YOK'),
    s.metin,
    'https://x.com/' + s.handle,
  ].map(kacis).join(','));
  // BOM: Excel'in Turkce karakterleri dogru okumasi icin sart.
  cikti = '﻿' + [basliklar.join(','), ...govde].join('\r\n');
  dosya = path.join(dir, 'kimlikler.csv');
}

fs.writeFileSync(dosya, cikti, 'utf8');

const kesin = secilen.filter((s) => s.kesin).length;
const supheli = secilen.filter((s) => s.id && !s.kesin).length;
const yok = secilen.filter((s) => !s.id).length;

console.log(`
  Kimlik listesi hazir
  --------------------
  Dosya   : ${dosya}
  Toplam  : ${secilen.length} katilimci
  Kesin   : ${kesin}   (yorumda "id:" gibi bir etiket vardi)
  Supheli : ${supheli}   (etiket yoktu, en olasi kelime secildi)
  Kimliksiz: ${yok}
`);
if (supheli || yok) {
  console.log(`  SUPHELI ve KIMLIK YOK satirlarini gozden gecir; dosyayi elle duzeltebilirsin.
  Cekilis bu listeden degil, X hesaplarindan yapilir — kimlik yalnizca odulu
  kime vereceğini bilmen icin.\n`);
}
