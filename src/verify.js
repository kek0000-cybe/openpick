import fs from 'node:fs';
import path from 'node:path';
import { drawDir, readJson } from './paths.js';
import { runDraw, commitHash } from './fairness.js';

/**
 * Bagimsiz dogrulama: sadece katilimci listesi + blok hash'inden yola cikip
 * kazananlari sifirdan yeniden hesaplar ve yayinlanan sonucla karsilastirir.
 * Bunu ucuncu bir kisi de calistirabilir.
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tweet') args.tweetId = argv[++i];
    else if (a === '--list') args.listFile = argv[++i];
    else if (a === '--block-hash') args.blockHash = argv[++i];
    else if (a === '--winners') args.winners = Number(argv[++i]);
    else if (a === '--backups') args.backups = Number(argv[++i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
let listFile = args.listFile;
let blockHash = args.blockHash;
let winners = args.winners;
let backups = args.backups ?? 0;
let published = null;

if (args.tweetId) {
  const dir = drawDir(args.tweetId);
  published = readJson(path.join(dir, 'result.json'));
  if (!published) {
    console.error('Sonuc dosyasi yok. Once: npm run draw -- --tweet ' + args.tweetId);
    process.exit(1);
  }
  listFile ??= path.join(dir, 'katilimcilar.txt');
  blockHash ??= published.bitcoin.blockHash;
  winners ??= published.winners.length;
  backups = args.backups ?? published.backups.length;
}

if (!listFile || !blockHash) {
  console.error(`
Kullanim:
  npm run verify -- --tweet <tweetId>
  npm run verify -- --list katilimcilar.txt --block-hash <hash> --winners 3
`);
  process.exit(1);
}

const handles = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
const computedCommit = commitHash(handles);
const result = runDraw({ handles, blockHash, winnerCount: winners ?? 1, backupCount: backups });

console.log(`
  BAGIMSIZ DOGRULAMA
  ==================
  Liste dosyasi   : ${listFile}
  Katilimci       : ${result.participantCount}
  Hesaplanan ozet : ${computedCommit}
  Blok hash       : ${blockHash}
  Tohum           : ${result.seed}

  Hesaplanan kazananlar:`);
result.winners.forEach((h, i) => console.log(`    ${i + 1}. @${h}`));

if (published) {
  const commitOk = published.commit === computedCommit;
  const winnersOk = JSON.stringify(published.winners) === JSON.stringify(result.winners);
  const seedOk = published.seed === result.seed;
  console.log(`
  Yayinlanan sonucla karsilastirma
  --------------------------------
  Liste ozeti  : ${commitOk ? 'ESLESTI' : 'ESLESMEDI'}
  Tohum        : ${seedOk ? 'ESLESTI' : 'ESLESMEDI'}
  Kazananlar   : ${winnersOk ? 'ESLESTI' : 'ESLESMEDI'}
`);
  process.exit(commitOk && winnersOk && seedOk ? 0 : 1);
}
console.log('');
