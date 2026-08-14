import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { drawDir, writeJson, ROOT } from '../src/paths.js';
import { commitHash } from '../src/fairness.js';
import { currentHeight, hashAtHeight } from '../src/bitcoin.js';

/**
 * Uctan uca duman testi: sahte katilimcilarla taahhut -> cekilis -> dogrulama.
 * Gercekte kullanilan gecmis bir Bitcoin blogunu kullanir, boylece beklemeden calisir.
 */
const TWEET_ID = 'smoketest';
const dir = drawDir(TWEET_ID);

const users = Array.from({ length: 250 }, (_, i) => ({
  id: String(i),
  handle: `test_kullanici_${i}`,
  name: `Test ${i}`,
  createdAt: new Date(Date.UTC(2020, 0, 1)).toISOString(),
  description: i % 3 === 0 ? '' : 'biyografi',
  location: '',
  followers: 100 + i,
  following: 50,
  tweets: i * 4,
  avatar: i % 10 === 0 ? 'default_profile_normal.png' : 'https://x/a.jpg',
  hasAvatar: i % 10 !== 0,
  hasBanner: i % 2 === 0,
  verified: false,
}));

writeJson(path.join(dir, 'participants.json'), {
  tweetUrl: `https://x.com/test/status/${TWEET_ID}`, tweetId: TWEET_ID, sources: { retweets: users.length }, users,
});

console.log('  1) Filtre + taahhut...');
// Filtreleri dogrudan uygula (commit.js gelecekteki blok ister; burada gecmis blok kullaniyoruz)
const { applyFilters } = await import('../src/filters.js');
const { passed, rejected } = applyFilters(users, { minTweets: 100, minAccountAgeDays: 30 });
const handles = passed.map((u) => u.handle);
const commit = commitHash(handles);
fs.writeFileSync(path.join(dir, 'katilimcilar.txt'),
  [...new Set(handles.map((h) => h.toLowerCase()))].sort().join('\n'), 'utf8');

const tip = await currentHeight();
const pastHeight = tip - 3;
const blockHash = await hashAtHeight(pastHeight);
console.log(`     ${users.length} kisiden ${passed.length} gecti, ${rejected.length} elendi`);
console.log(`     ozet: ${commit.slice(0, 16)}...`);

writeJson(path.join(dir, 'commitment.json'), {
  tweetUrl: `https://x.com/test/status/${TWEET_ID}`, tweetId: TWEET_ID,
  committedAt: new Date().toISOString(), participantCount: passed.length,
  rejectedCount: rejected.length, filters: {}, commit,
  bitcoin: { tipAtCommit: pastHeight - 6, targetHeight: pastHeight },
});
console.log(`     blok ${pastHeight}: ${blockHash.slice(0, 16)}...`);

console.log('  2) Cekilis...');
execFileSync('node', ['src/draw.js', '--tweet', TWEET_ID, '--winners', '3', '--backups', '2'],
  { cwd: ROOT, stdio: 'inherit' });

console.log('  3) Bagimsiz dogrulama...');
execFileSync('node', ['src/verify.js', '--tweet', TWEET_ID], { cwd: ROOT, stdio: 'inherit' });

console.log('  Duman testi tamam.\n');
