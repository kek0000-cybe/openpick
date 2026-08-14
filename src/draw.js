import fs from 'node:fs';
import path from 'node:path';
import { drawDir, readJson, writeJson } from './paths.js';
import { runDraw } from './fairness.js';
import { rastgeleligiAl, kaynakBilgisi } from './randomness.js';

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

const kaynak = await rastgeleligiAl(commitment);
if (!kaynak.hazir) {
  console.error(`\n  ${kaynak.mesaj}\n  Otomatik beklemek icin: npm run watch -- --tweet ${args.tweetId}\n`);
  process.exit(1);
}
if (kaynak.confirmedBy < 2) {
  console.log('  ! Deger yalnizca tek kaynaktan dogrulanabildi.');
}

const handles = fs.readFileSync(path.join(dir, 'katilimcilar.txt'), 'utf8').split('\n').filter(Boolean);

const result = runDraw({
  handles,
  blockHash: kaynak.deger,
  winnerCount: args.winners,
  backupCount: args.backups,
  commit: commitment.commit,
});

const record = {
  ...commitment,
  drawnAt: new Date().toISOString(),
  randomness: { ...kaynakBilgisi(commitment), value: kaynak.deger, confirmedBy: kaynak.confirmedBy },
  seed: result.seed,
  winners: result.winners,
  backups: result.backups,
  steps: result.steps,
};
delete record.bitcoin;
writeJson(path.join(dir, 'result.json'), record);

console.log(`
  CEKILIS SONUCU
  ==============
  Katilimci  : ${result.participantCount}
  Liste ozeti: ${result.commit}
  Kaynak     : ${kaynak.etiket}
  Deger      : ${kaynak.deger}
  Tohum      : ${result.seed}

  Kazananlar:`);
result.winners.forEach((h, i) => console.log(`    ${i + 1}. @${h}`));
if (result.backups.length) {
  console.log('\n  Yedekler (sirayla):');
  result.backups.forEach((h, i) => console.log(`    ${i + 1}. @${h}`));
}
console.log(`
  Kaydedildi: ${path.join(dir, 'result.json')}
  Siteye    : npm run publish -- --tweet ${args.tweetId}
`);
