import fs from 'node:fs';
import path from 'node:path';
import { drawDir, writeJson } from '../src/paths.js';
import { commitHash, canonicalize, runDraw } from '../src/fairness.js';
import { currentHeight, blockAt } from '../src/bitcoin.js';

/**
 * Gercek cekilis beklemeden siteyi test edebilmek icin ornek veri uretir.
 * Uc evre birden olusturulur: sonuclanmis, kilitli (geri sayim) ve blok bekleyen.
 */
const SONUCLANDI = '1900000000000000001';
const KILITLI = '1900000000000000002';
const BEKLIYOR = '1900000000000000003';

function users(n, seed) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    handle: `${seed}_${i}`,
    name: `Katilimci ${i}`,
    createdAt: new Date(Date.UTC(2019, 5, 1)).toISOString(),
    description: 'ornek biyografi',
    location: 'Istanbul',
    followers: 100 + i,
    following: 80,
    tweets: 150 + i * 3,
    avatar: '',
    hasAvatar: true,
    hasBanner: i % 2 === 0,
    verified: false,
    via: ['retweets'],
  }));
}

function base(tweetId, count, seedName) {
  const dir = drawDir(tweetId);
  const list = users(count, seedName);
  writeJson(path.join(dir, 'participants.json'), {
    tweetUrl: `https://x.com/ornek/status/${tweetId}`,
    tweetId, sources: { retweets: count }, users: list,
  });
  const handles = list.map((u) => u.handle);
  fs.writeFileSync(path.join(dir, 'katilimcilar.txt'), canonicalize(handles), 'utf8');
  writeJson(path.join(dir, 'rejected.json'), [
    { handle: 'elenen_bir', reason: 'profil fotografi yok' },
    { handle: 'elenen_iki', reason: 'tweet sayısı yetersiz (< 100)' },
  ]);
  return { dir, handles };
}

const tip = await currentHeight();

/* 1) Sonuclanmis cekilis — gecmis bir blok kullanilir. */
{
  const { dir, handles } = base(SONUCLANDI, 180, 'kazanan');
  const height = tip - 4;
  const block = await blockAt(height);
  const commit = commitHash(handles);
  const commitment = {
    tweetUrl: `https://x.com/ornek/status/${SONUCLANDI}`,
    tweetId: SONUCLANDI,
    title: 'DEMO — sonuclanmis ornek cekilis',
    prize: 'Gercek bir odul degil, sistemi gostermek icin uretilmis ornek',
    committedAt: new Date(Date.now() - 3600_000).toISOString(),
    drawAt: new Date(Date.now() - 1800_000).toISOString(),
    participantCount: handles.length,
    rejectedCount: 2,
    filters: { mustHaveAvatar: true, minTweets: 100, minAccountAgeDays: 30 },
    commit,
    commitTweetUrl: `https://x.com/ornek/status/${SONUCLANDI}`,
    bitcoin: { tipAtCommit: height - 6, targetHeight: height },
  };
  const r = runDraw({ handles, blockHash: block.hash, winnerCount: 3, backupCount: 2, commit });
  writeJson(path.join(dir, 'commitment.json'), commitment);
  writeJson(path.join(dir, 'result.json'), {
    ...commitment,
    drawnAt: new Date().toISOString(),
    bitcoin: { ...commitment.bitcoin, blockHash: block.hash, confirmedBy: 2 },
    seed: r.seed, winners: r.winners, backups: r.backups, steps: r.steps,
  });
  console.log(`  sonuclandi : ${SONUCLANDI} — kazanan @${r.winners[0]}`);
}

/* 2) Kilitli — geri sayim 90 dakika sonra. */
{
  const { dir, handles } = base(KILITLI, 420, 'kilitli');
  writeJson(path.join(dir, 'commitment.json'), {
    tweetUrl: `https://x.com/ornek/status/${KILITLI}`,
    tweetId: KILITLI,
    title: 'DEMO — geri sayim ornegi',
    prize: 'Gercek bir odul degil, geri sayimi gostermek icin uretilmis ornek',
    committedAt: new Date().toISOString(),
    drawAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    participantCount: handles.length,
    rejectedCount: 2,
    filters: { mustHaveAvatar: true, minTweets: 100, minAccountAgeDays: 30 },
    commit: commitHash(handles),
    commitTweetUrl: null,
    bitcoin: { tipAtCommit: tip, targetHeight: tip + 9 },
  });
  console.log(`  kilitli    : ${KILITLI} — 90 dakika geri sayim`);
}

/* 3) Blok bekleniyor — saat gecti, hedef blok henuz kazilmadi. */
{
  const { dir, handles } = base(BEKLIYOR, 95, 'bekleyen');
  writeJson(path.join(dir, 'commitment.json'), {
    tweetUrl: `https://x.com/ornek/status/${BEKLIYOR}`,
    tweetId: BEKLIYOR,
    title: 'DEMO — blok bekleme ornegi',
    prize: 'Gercek bir odul degil, canli acilisi gostermek icin uretilmis ornek',
    committedAt: new Date(Date.now() - 7200_000).toISOString(),
    drawAt: new Date(Date.now() - 60_000).toISOString(),
    participantCount: handles.length,
    rejectedCount: 2,
    filters: { mustHaveAvatar: true, minTweets: 100, minAccountAgeDays: 30 },
    commit: commitHash(handles),
    commitTweetUrl: null,
    bitcoin: { tipAtCommit: tip, targetHeight: tip + 2 },
  });
  console.log(`  bekleyen   : ${BEKLIYOR} — hedef blok ${tip + 2}`);
}

console.log('\n  Simdi: npm run publish && npm run site\n');
