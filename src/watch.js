import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ROOT, DATA_DIR, readJson } from './paths.js';
import { rastgeleligiAl, kaynakBilgisi, kaynakEtiketi } from './randomness.js';

/**
 * Otomatik cekilis bekcisi.
 * Rastgelelik gelene kadar bekler, sonra sirayla:
 *   cekilis -> siteyi uret -> (istege bagli) siteye gonder
 * Taahhutten sonra hicbir sey yapmana gerek kalmaz.
 */
function parseArgs(argv) {
  const a = { winners: 1, backups: 0, push: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--tweet') a.tweetId = argv[++i];
    else if (k === '--winners') a.winners = Number(argv[++i]);
    else if (k === '--backups') a.backups = Number(argv[++i]);
    else if (k === '--push') a.push = true;
  }
  if (!a.tweetId) {
    console.error(`
Kullanim: npm run watch -- --tweet <tweetId> [--winners 1] [--backups 2] [--push]

  --push   Bitince sonucu herkese acik siteye de gonderir.
`);
    process.exit(1);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const dir = path.join(DATA_DIR, args.tweetId);
const commitment = readJson(path.join(dir, 'commitment.json'));
if (!commitment) {
  console.error(`\n  Taahhut yok. Once: npm run commit -- --tweet ${args.tweetId}\n`);
  process.exit(1);
}

const kaynak = kaynakBilgisi(commitment);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saat = () => new Date().toLocaleTimeString('tr-TR');

function calistir(komut, argv) {
  return new Promise((resolve, reject) => {
    const ps = spawn(komut, argv, { cwd: ROOT, stdio: 'inherit', shell: komut === 'git' });
    ps.on('close', (kod) => (kod === 0 ? resolve() : reject(new Error(`cikis kodu ${kod}`))));
    ps.on('error', reject);
  });
}

console.log(`
  Bekci calisiyor
  ---------------
  Cekilis : ${args.tweetId}
  Kaynak  : ${kaynakEtiketi(kaynak)}
  Kazanan : ${args.winners} (+${args.backups} yedek)
  Siteye  : ${args.push ? 'otomatik gonderilecek' : 'yalnizca yerel'}

  Bu pencereyi acik birak; gerisi kendiliginden olacak.
`);

// drand 3 saniyede bir uretiyor, Bitcoin ~10 dakikada. Bosuna sorgu atmayalim.
const aralik = kaynak.source === 'drand' ? 2000 : 60_000;
let sonMesaj = '';

while (true) {
  try {
    const r = await rastgeleligiAl(commitment);
    if (r.hazir) {
      console.log(`\n  [${saat()}] ${r.etiket} hazir. Cekilis yapiliyor...\n`);

      if (!fs.existsSync(path.join(dir, 'result.json'))) {
        await calistir(process.execPath, ['src/draw.js', '--tweet', args.tweetId,
          '--winners', String(args.winners), '--backups', String(args.backups)]);
      } else {
        console.log('  (sonuc zaten vardi, cekilis atlandi)');
      }

      console.log(`\n  [${saat()}] Site uretiliyor...\n`);
      await calistir(process.execPath, ['src/publish.js', '--tweet', args.tweetId]);

      if (args.push) {
        console.log(`\n  [${saat()}] Siteye gonderiliyor...\n`);
        await calistir('git', ['add', '-A']);
        await calistir('git', ['commit', '-m', `cekilis ${args.tweetId}`]);
        await calistir('git', ['push']);
        console.log('\n  Yayinlandi. Birkac dakika icinde sitede gorunur.\n');
      } else {
        console.log('\n  Yerelde hazir. Gondermek icin: git add -A; git commit -m "cekilis"; git push\n');
      }
      break;
    }

    if (r.mesaj !== sonMesaj) {
      sonMesaj = r.mesaj;
      console.log(`  [${saat()}] ${r.mesaj}`);
    }
  } catch (err) {
    console.log(`  [${saat()}] sorgu basarisiz: ${err.message} — tekrar denenecek`);
  }
  await sleep(aralik);
}
