import fs from 'node:fs';
import path from 'node:path';
import { drawDir, readJson, writeJson } from './paths.js';
import { applyFilters } from './filters.js';
import { commitHash, canonicalize } from './fairness.js';
import { currentHeight } from './bitcoin.js';

const BLOCK_SECONDS = 600; // Bitcoin'de ortalama blok araligi

function parseArgs(argv) {
  const args = { blocksAhead: 6, filters: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tweet') args.tweetId = argv[++i];
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

  --draw-at <ISO>       Cekilis saati, orn. 2026-08-20T21:00:00+03:00
  --blocks-ahead <n>    --draw-at verilmezse kac blok sonra (varsayilan 6)
  --title "..."         Sitede gorunecek baslik
  --prize "..."         Odul aciklamasi
  --commit-tweet <url>  Taahhut tweetinin linki (sonradan da eklenebilir)

Filtreler: --min-tweets --min-age-days --require-banner --require-bio
           --require-location --allow-default-avatar --exclude @a,@b
`);
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
    console.error(`\n  --draw-at anlasilamadi: ${args.drawAt}\n  Ornek: 2026-08-20T21:00:00+03:00\n`);
    process.exit(1);
  }
  if (drawAt <= now) {
    console.error('\n  --draw-at gelecekte olmali.\n');
    process.exit(1);
  }
} else {
  if (!Number.isInteger(args.blocksAhead) || args.blocksAhead < 1) {
    console.error('\n  --blocks-ahead en az 1 olmali: tohum gelecekteki bir bloktan gelmeli.\n');
    process.exit(1);
  }
  drawAt = new Date(now.getTime() + args.blocksAhead * BLOCK_SECONDS * 1000);
}

const { passed, rejected, filters } = applyFilters(data.users, args.filters);
if (passed.length === 0) {
  console.error('Filtrelerden gecen katilimci kalmadi.');
  process.exit(1);
}

const handles = passed.map((u) => u.handle);
const commit = commitHash(handles);
const tip = await currentHeight();

/*
 * Taahhut BLOK YUKSEKLIGI olarak sabitlenir, saat olarak degil.
 * Blok zaman damgalari monotonik degildir ve kismen madenci kontrolundedir;
 * "su saatten sonraki ilk blok" tanimi hem oynatilabilir hem de dogrulayaniN
 * bir API'ye sormasini gerektirirdi. Yukseklik ise kesin, oynatilamaz ve
 * herhangi bir blok gezgininden cevrimdisi teyit edilebilir.
 * drawAt yalnizca geri sayim icindir; sonuca hicbir etkisi yoktur.
 */
const blocksAway = Math.max(1, Math.ceil((drawAt - now) / (BLOCK_SECONDS * 1000)));
const targetHeight = tip + blocksAway;

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
  bitcoin: { tipAtCommit: tip, targetHeight },
};
writeJson(path.join(dir, 'commitment.json'), commitment);
writeJson(path.join(dir, 'rejected.json'), rejected);

const localTime = drawAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

console.log(`
  Taahhut olusturuldu
  -------------------
  Katilimci sayisi : ${passed.length}   (elenen: ${rejected.length})
  Liste ozeti      : ${commit}
  Cekilis saati    : ${localTime}
  Bitcoin blogu    : ${targetHeight}   (su an ${tip})

  Simdi asagidaki metni tweetle. Bu tweet kanitin belkemigi: taahhudun blok
  kazilmadan ONCE yayinlandigini gosteren tek delil o.

  ----------------------------------------------------------------
  Cekilis katilimi kapandi.
  Katilimci: ${passed.length}
  Liste ozeti (SHA-256): ${commit}
  Tohum: ${targetHeight} numarali Bitcoin blogunun hash'i
  Cekilis: ${localTime}
  Kazananlari herkes kendi tarayicisinda dogrulayabilecek.
  ----------------------------------------------------------------

  Tweeti attiktan sonra linkini kaydet:
    npm run commit -- --tweet ${args.tweetId} --commit-tweet <tweet-linki>   (ayni ayarlarla)

  Blok kazilinca:
    npm run draw -- --tweet ${args.tweetId} --winners 3
`);
