import fs from 'node:fs';
import path from 'node:path';
import { drawDir, readJson, writeJson } from './paths.js';
import { applyFilters } from './filters.js';
import { commitHash, canonicalize } from './fairness.js';
import { currentHeight } from './bitcoin.js';
import { roundAt, roundTime, DRAND } from './beacon.js';

const BLOCK_SECONDS = 600;

function parseArgs(argv) {
  const args = { source: 'drand', inSeconds: 120, blocksAhead: 6, filters: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tweet') args.tweetId = argv[++i];
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--in') args.inSeconds = Number(argv[++i]);
    else if (a === '--draw-at') args.drawAt = argv[++i];
    else if (a === '--blocks-ahead') args.blocksAhead = Number(argv[++i]);
    else if (a === '--commit-tweet') args.commitTweetUrl = argv[++i];
    else if (a === '--title') args.title = argv[++i];
    else if (a === '--prize') args.prize = argv[++i];
    else if (a === '--min-tweets') args.filters.minTweets = Number(argv[++i]);
    else if (a === '--min-age-days') args.filters.minAccountAgeDays = Number(argv[++i]);
    else if (a === '--require-banner') args.filters.mustHaveBanner = true;
    else if (a === '--require-bio') args.filters.mustHaveDescription = true;
    else if (a === '--require-location') args.filters.mustHaveLocation = true;
    else if (a === '--allow-default-avatar') args.filters.mustHaveAvatar = false;
    else if (a === '--exclude') args.filters.excludeHandles = argv[++i].split(',');
  }
  if (!args.tweetId) {
    console.error(`
Kullanim: npm run commit -- --tweet <tweetId> [secenekler]

  --source drand    (varsayilan) 3 saniyelik turlar — sonuc neredeyse aninda
  --source bitcoin  ~10 dakikalik bloklar — daha yavas
  --in <saniye>     Cekilise kalan sure (drand, varsayilan 120)
  --draw-at <ISO>   Kesin cekilis saati, orn. 2026-08-20T21:00:00+03:00
  --title "..."     Sitede gorunecek baslik
  --prize "..."     Odul aciklamasi
  --commit-tweet <url>

Filtreler: --min-tweets --min-age-days --require-banner --require-bio
           --require-location --allow-default-avatar --exclude @a,@b
`);
    process.exit(1);
  }
  if (!['drand', 'bitcoin'].includes(args.source)) {
    console.error(`\n  --source yalnizca "drand" ya da "bitcoin" olabilir.\n`);
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const dir = drawDir(args.tweetId);
const data = readJson(path.join(dir, 'participants.json'));
if (!data) {
  console.error('Katilimci dosyasi yok. Once: npm run collect -- --url <link>');
  process.exit(1);
}

const now = new Date();
let drawAt;
if (args.drawAt) {
  drawAt = new Date(args.drawAt);
  if (Number.isNaN(drawAt.getTime())) {
    console.error(`\n  --draw-at anlasilamadi: ${args.drawAt}\n`);
    process.exit(1);
  }
} else if (args.source === 'drand') {
  drawAt = new Date(now.getTime() + Math.max(15, args.inSeconds) * 1000);
} else {
  drawAt = new Date(now.getTime() + Math.max(1, args.blocksAhead) * BLOCK_SECONDS * 1000);
}
if (drawAt <= now) {
  console.error('\n  Cekilis ani gelecekte olmali.\n');
  process.exit(1);
}

const { passed, rejected, filters } = applyFilters(data.users, args.filters);
if (passed.length === 0) {
  console.error('Filtrelerden gecen katilimci kalmadi.');
  process.exit(1);
}

const handles = passed.map((u) => u.handle);
const commit = commitHash(handles);

/*
 * Rastgelelik kaynagi GELECEKTE bir noktaya sabitlenir.
 * O an gelmeden deger uretilmedigi icin ne biz ne baskasi sonucu bilebilir;
 * bilinebilseydi liste ya da filtreler istenen kazanan cikana kadar denenirdi.
 */
let randomness;
if (args.source === 'drand') {
  const hedefTur = roundAt(Math.floor(drawAt.getTime() / 1000));
  const suan = roundAt(Math.floor(now.getTime() / 1000));
  if (hedefTur <= suan) {
    console.error('\n  Hedef tur gecmiste kaliyor. --in degerini buyut.\n');
    process.exit(1);
  }
  randomness = {
    source: 'drand',
    chain: DRAND.chain,
    round: hedefTur,
    roundAt: new Date(roundTime(hedefTur) * 1000).toISOString(),
  };
  drawAt = new Date(roundTime(hedefTur) * 1000);
} else {
  const tip = await currentHeight();
  const blocksAway = Math.max(1, Math.ceil((drawAt - now) / (BLOCK_SECONDS * 1000)));
  randomness = { source: 'bitcoin', tipAtCommit: tip, targetHeight: tip + blocksAway };
}

const canonicalList = canonicalize(handles);
fs.writeFileSync(path.join(dir, 'katilimcilar.txt'), canonicalList, 'utf8');

const commitment = {
  tweetUrl: data.tweetUrl,
  tweetId: args.tweetId,
  title: args.title ?? null,
  prize: args.prize ?? null,
  committedAt: now.toISOString(),
  drawAt: drawAt.toISOString(),
  participantCount: passed.length,
  rejectedCount: rejected.length,
  filters,
  commit,
  commitTweetUrl: args.commitTweetUrl ?? null,
  randomness,
};
writeJson(path.join(dir, 'commitment.json'), commitment);
writeJson(path.join(dir, 'rejected.json'), rejected);

const yerel = drawAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
const kaynakMetin = randomness.source === 'drand'
  ? `drand turu ${randomness.round}`
  : `${randomness.targetHeight} numarali Bitcoin blogu`;
const kalanSn = Math.round((drawAt - now) / 1000);

console.log(`
  Taahhut olusturuldu
  -------------------
  Katilimci  : ${passed.length}   (elenen: ${rejected.length})
  Liste ozeti: ${commit}
  Kaynak     : ${kaynakMetin}
  Cekilis    : ${yerel}   (${kalanSn} saniye sonra)

  Asagidaki metni tweetle. Bu tweet kanitin belkemigi: taahhudun rastgelelik
  uretilmeden ONCE yayinlandigini gosteren tek delil o.

  ----------------------------------------------------------------
  Cekilis katilimi kapandi.
  Katilimci: ${passed.length}
  Liste ozeti (SHA-256): ${commit}
  Tohum: ${kaynakMetin}
  Cekilis: ${yerel}
  Kazananlari herkes kendi tarayicisinda dogrulayabilecek.
  ----------------------------------------------------------------

  Cekilis:  npm run draw -- --tweet ${args.tweetId} --winners 1
  Otomatik: npm run watch -- --tweet ${args.tweetId} --winners 1
`);
