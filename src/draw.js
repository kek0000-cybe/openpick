import fs from 'node:fs';
import path from 'node:path';
import { drawDir, readJson, writeJson } from './paths.js';
import { runDraw } from './fairness.js';
import { hashAtHeightConfirmed, currentHeight } from './bitcoin.js';

function parseArgs(argv) {
  const args = { winners: 1, backups: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tweet') args.tweetId = argv[++i];
    else if (a === '--winners') args.winners = Number(argv[++i]);
    else if (a === '--backups') args.backups = Number(argv[++i]);
  }
  if (!args.tweetId) {
    console.error('\nKullanim: npm run draw -- --tweet <tweetId> [--winners 3] [--backups 2]\n');
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const dir = drawDir(args.tweetId);
const commitment = readJson(path.join(dir, 'commitment.json'));
if (!commitment) {
  console.error('Taahhut bulunamadi. Once: npm run commit -- --tweet ' + args.tweetId);
  process.exit(1);
}

const target = commitment.bitcoin.targetHeight;
const { hash: blockHash, confirmedBy } = await hashAtHeightConfirmed(target);
if (!blockHash) {
  const tip = await currentHeight();
  console.error(`
  ${target} numarali blok henuz kazilmadi (su anki yukseklik: ${tip}).
  Yaklasik ${Math.max(0, (target - tip) * 10)} dakika sonra tekrar dene.
`);
  process.exit(1);
}
if (confirmedBy < 2) {
  console.log('  ! Blok hash yalnizca tek saglayicidan dogrulanabildi.');
}

const listFile = path.join(dir, 'katilimcilar.txt');
const handles = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);

const result = runDraw({
  handles,
  blockHash,
  winnerCount: args.winners,
  backupCount: args.backups,
  commit: commitment.commit,
});

const record = {
  ...commitment,
  drawnAt: new Date().toISOString(),
  bitcoin: { ...commitment.bitcoin, blockHash, confirmedBy },
  seed: result.seed,
  winners: result.winners,
  backups: result.backups,
  steps: result.steps,
};
writeJson(path.join(dir, 'result.json'), record);

console.log(`
  CEKILIS SONUCU
  ==============
  Katilimci sayisi : ${result.participantCount}
  Liste ozeti      : ${result.commit}
  Blok ${String(target).padEnd(11)}: ${blockHash}
  Tohum            : ${result.seed}

  Kazananlar:`);
result.winners.forEach((h, i) => console.log(`    ${i + 1}. @${h}`));
if (result.backups.length) {
  console.log('\n  Yedekler (sirayla):');
  result.backups.forEach((h, i) => console.log(`    ${i + 1}. @${h}`));
}
console.log(`
  Kaydedildi: ${path.join(dir, 'result.json')}
  Bagimsiz dogrulama: npm run verify -- --tweet ${args.tweetId}
  Siteye yayinla    : npm run publish -- --tweet ${args.tweetId}
`);
