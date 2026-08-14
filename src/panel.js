import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ROOT, DATA_DIR, readJson, parseTweetUrl } from './paths.js';
import { kimlikTahmini } from './kimlik.js';

/**
 * YEREL yonetim paneli. Tweet linkini yapistirip cekilisi bastan sona yurutursun.
 *
 * ⚠️ Bu sunucu komut calistirabiliyor. Iki koruma var ve ikisi de zorunlu:
 *    1) Yalnizca 127.0.0.1'e baglanir — ag uzerinden erisilemez.
 *    2) Calistirilabilecek komutlar sabit bir listede; argumanlar dizi olarak
 *       verilir, kabuk kullanilmaz. Yani komut enjeksiyonu mumkun degil.
 *    Bu panel ASLA docs/ altina girmez, yani herkese acik siteye gitmez.
 */
const PORT = Number(process.env.PANEL_PORT ?? 8090);
const PANEL_DIR = path.join(ROOT, 'web', 'panel');

const jobs = new Map();

/** Sadece bu dort komut calistirilabilir. */
const KOMUTLAR = {
  collect: (a) => {
    const { tweetId } = parseTweetUrl(a.url);
    const args = ['src/collect.js', '--url', String(a.url)];
    if (a.types?.length) args.push('--types', a.types.join(','));
    if (a.max) args.push('--max', String(Number(a.max)));
    if (a.slow) args.push('--slow');
    return { args, tweetId };
  },
  commit: (a) => {
    const id = String(a.tweetId).replace(/[^0-9]/g, '');
    const args = ['src/commit.js', '--tweet', id];
    if (a.drawAt) args.push('--draw-at', String(a.drawAt));
    if (a.title) args.push('--title', String(a.title));
    if (a.prize) args.push('--prize', String(a.prize));
    if (a.commitTweetUrl) args.push('--commit-tweet', String(a.commitTweetUrl));
    if (a.minTweets) args.push('--min-tweets', String(Number(a.minTweets)));
    if (a.minAgeDays) args.push('--min-age-days', String(Number(a.minAgeDays)));
    if (a.requireBanner) args.push('--require-banner');
    if (a.requireBio) args.push('--require-bio');
    if (a.requireLocation) args.push('--require-location');
    if (a.allowDefaultAvatar) args.push('--allow-default-avatar');
    if (a.exclude) args.push('--exclude', String(a.exclude));
    return { args, tweetId: id };
  },
  draw: (a) => {
    const id = String(a.tweetId).replace(/[^0-9]/g, '');
    return {
      args: ['src/draw.js', '--tweet', id,
        '--winners', String(Number(a.winners) || 1),
        '--backups', String(Number(a.backups) || 0)],
      tweetId: id,
    };
  },
  publish: (a) => {
    const id = String(a.tweetId).replace(/[^0-9]/g, '');
    return { args: ['src/publish.js', '--tweet', id], tweetId: id };
  },
  liste: (a) => {
    const id = String(a.tweetId).replace(/[^0-9]/g, '');
    return { args: ['src/liste.js', '--tweet', id], tweetId: id };
  },
  watch: (a) => {
    const id = String(a.tweetId).replace(/[^0-9]/g, '');
    const args = ['src/watch.js', '--tweet', id,
      '--winners', String(Number(a.winners) || 1),
      '--backups', String(Number(a.backups) || 0)];
    if (a.push) args.push('--push');
    return { args, tweetId: id };
  },
  login: () => ({ args: ['src/login.js'] }),
};

function baslat(komut, gelen) {
  const yapici = KOMUTLAR[komut];
  if (!yapici) throw new Error(`Bilinmeyen komut: ${komut}`);
  const { args, tweetId } = yapici(gelen ?? {});

  const id = randomUUID();
  const job = { id, komut, tweetId, log: '', bitti: false, kod: null };
  jobs.set(id, job);

  // Kabuk yok, argumanlar dizi: enjeksiyon yuzeyi yok.
  const ps = spawn(process.execPath, args, { cwd: ROOT });
  const ekle = (b) => {
    job.log += b.toString();
    if (job.log.length > 200_000) job.log = job.log.slice(-200_000);
  };
  ps.stdout.on('data', ekle);
  ps.stderr.on('data', ekle);
  ps.on('close', (kod) => { job.bitti = true; job.kod = kod; });
  ps.on('error', (err) => { job.log += `\n${err.message}`; job.bitti = true; job.kod = -1; });
  return job;
}

/** Bir cekilisin yereldeki durumu. */
function durum(tweetId) {
  const dir = path.join(DATA_DIR, tweetId);
  const katilimcilar = readJson(path.join(dir, 'participants.json'));
  const taahhut = readJson(path.join(dir, 'commitment.json'));
  const sonuc = readJson(path.join(dir, 'result.json'));
  const yayinda = fs.existsSync(path.join(ROOT, 'docs', tweetId, 'index.html'));
  return {
    tweetId,
    toplanan: katilimcilar?.users?.length ?? 0,
    toplandi: Boolean(katilimcilar),
    taahhut: taahhut ? {
      commit: taahhut.commit, drawAt: taahhut.drawAt,
      targetHeight: taahhut.bitcoin?.targetHeight,
      participantCount: taahhut.participantCount, rejectedCount: taahhut.rejectedCount,
      title: taahhut.title, prize: taahhut.prize, commitTweetUrl: taahhut.commitTweetUrl,
    } : null,
    sonuc: sonuc ? { winners: sonuc.winners, backups: sonuc.backups, blockHash: sonuc.bitcoin?.blockHash } : null,
    yayinda,
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function json(res, kod, veri) {
  const body = JSON.stringify(veri);
  res.writeHead(kod, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function govde(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const yol = url.pathname;

  try {
    if (yol === '/api/baslat' && req.method === 'POST') {
      const g = await govde(req);
      const job = baslat(g.komut, g.args);
      return json(res, 200, { jobId: job.id, tweetId: job.tweetId });
    }
    if (yol.startsWith('/api/job/')) {
      const job = jobs.get(yol.slice(9));
      if (!job) return json(res, 404, { hata: 'is bulunamadi' });
      return json(res, 200, { log: job.log, bitti: job.bitti, kod: job.kod, tweetId: job.tweetId });
    }
    if (yol === '/api/durum') {
      const id = (url.searchParams.get('tweet') ?? '').replace(/[^0-9]/g, '');
      if (!id) return json(res, 400, { hata: 'tweet gerekli' });
      return json(res, 200, durum(id));
    }
    if (yol === '/api/cekilisler') {
      const ids = fs.existsSync(DATA_DIR)
        ? fs.readdirSync(DATA_DIR).filter((d) => /^[0-9]{5,25}$/.test(d)) : [];
      return json(res, 200, ids.map(durum));
    }
    // Kimlik listesi: dosya uretmeden dogrudan hesaplanir, panelde tablo olarak gosterilir.
    if (yol === '/api/kimlikler') {
      const id = (url.searchParams.get('tweet') ?? '').replace(/[^0-9]/g, '');
      const data = readJson(path.join(DATA_DIR, id, 'participants.json'));
      if (!data) return json(res, 404, { hata: 'katilimci dosyasi yok' });
      const yorumlu = data.users.filter((u) => u.replyText !== undefined);
      return json(res, 200, yorumlu.map((u) => {
        const t = u.replyId !== undefined
          ? { id: u.replyId, kesin: u.replyIdKesin }
          : kimlikTahmini(u.replyText);
        return {
          handle: u.handle,
          id: t.id ?? null,
          guven: t.kesin ? 'kesin' : (t.id ? 'supheli' : 'yok'),
          yorum: (u.replyText ?? '').replace(/\s+/g, ' ').trim(),
        };
      }).sort((a, b) => (a.guven === b.guven ? 0 : a.guven === 'kesin' ? -1 : b.guven === 'kesin' ? 1 : 0)));
    }
    if (yol === '/api/kimlikler.csv') {
      const id = (url.searchParams.get('tweet') ?? '').replace(/[^0-9]/g, '');
      const dosya = path.join(DATA_DIR, id, 'kimlikler.csv');
      if (!fs.existsSync(dosya)) return json(res, 404, { hata: 'once listeyi olustur' });
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="kimlikler-${id}.csv"`,
      });
      return fs.createReadStream(dosya).pipe(res);
    }
    if (yol === '/api/cozumle' && req.method === 'POST') {
      const g = await govde(req);
      try { return json(res, 200, parseTweetUrl(g.url)); }
      catch (e) { return json(res, 400, { hata: e.message }); }
    }
  } catch (err) {
    return json(res, 500, { hata: err.message });
  }

  // Ortak stil dosyasi panel disinda duruyor; tek istisna olarak sunuluyor.
  if (yol === '/site.css') {
    res.writeHead(200, { 'content-type': MIME['.css'] });
    return fs.createReadStream(path.join(ROOT, 'web', 'assets', 'site.css')).pipe(res);
  }

  // Statik panel dosyalari
  const dosya = path.join(PANEL_DIR, yol === '/' ? 'index.html' : yol);
  if (!dosya.startsWith(PANEL_DIR) || !fs.existsSync(dosya)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('bulunamadi');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(dosya)] ?? 'application/octet-stream' });
  fs.createReadStream(dosya).pipe(res);
});

// SADECE yerel arayuz. Ag uzerinden erisilemez.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`
  Yonetim paneli: http://localhost:${PORT}

  Bu panel yalnizca senin bilgisayarindan erisilebilir ve herkese acik
  siteye dahil edilmez. Durdurmak icin Ctrl+C.
`);
});
