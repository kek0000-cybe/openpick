/*
 * Çekiliş sayfasının davranışı.
 *
 * NOT: Bu dosya publish.js tarafından engine.js ve chain.js ile birlikte
 * TEK bir <script> bloğuna gömülür. Bu yüzden import yazmaz; yukarıdaki iki
 * dosyanın tanımlarını doğrudan kullanır. İsim çakışmasını önlemek için
 * buradaki her şey "p" öneki taşır ya da benzersizdir.
 */
const pDraw = window.__CEKILIS__;
const pEl = (id) => document.getElementById(id);
const pPad = (n) => String(n).padStart(2, '0');

function pPhase(now = Date.now()) {
  if (!pDraw.commit) return 'acik';
  if (pDraw.bitcoin && pDraw.bitcoin.blockHash) return 'sonuclandi';
  if (pRevealed.blockHash) return 'sonuclandi';
  if (now < new Date(pDraw.drawAt).getTime()) return 'kilitli';
  return 'blok-bekleniyor';
}

const pRevealed = { blockHash: null, result: null };

function pShow(phase) {
  for (const node of document.querySelectorAll('[data-phase]')) {
    node.classList.toggle('hidden', !node.dataset.phase.split(' ').includes(phase));
  }
}

/* ---------- Geri sayım ---------- */
function pTickClock() {
  const phase = pPhase();
  pShow(phase);

  const box = pEl('clock');
  if (!box) return;
  const targetIso = phase === 'acik' ? pDraw.lockAt || pDraw.drawAt : pDraw.drawAt;
  if (!targetIso) return;

  let left = Math.max(0, new Date(targetIso).getTime() - Date.now());
  const s = Math.floor(left / 1000);
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const cells = box.querySelectorAll('.clock-num');
  if (cells.length === 3) {
    cells[0].textContent = pPad(parts[0]);
    cells[1].textContent = pPad(parts[1]);
    cells[2].textContent = pPad(parts[2]);
  }

  if (phase === 'blok-bekleniyor') pStartWatching();
  if (phase === 'sonuclandi') pRenderResult();
}

/* ---------- Blok bekleme ve canlı açılış ---------- */
let pWatching = false;
let pStopAt = 0;

async function pStartWatching() {
  if (pWatching) return;
  pWatching = true;
  pStopAt = Date.now() + 2 * 60 * 60 * 1000; // 2 saat sonra elle denemeye bırak
  pWatchLoop();
}

async function pWatchLoop() {
  const height = pDraw.bitcoin.targetHeight;
  const status = pEl('watch-status');

  while (Date.now() < pStopAt) {
    if (document.visibilityState === 'hidden') {
      await pSleep(5000);
      continue;
    }
    try {
      const tip = await currentHeight();
      if (status) {
        const away = Math.max(0, height - tip);
        status.textContent = away === 0
          ? 'Blok kazıldı, sonuç hesaplanıyor...'
          : `Hedef blok ${height} · şu anki yükseklik ${tip} · yaklaşık ${away * 10} dakika`;
      }
      const { hash, confirmedBy } = await hashAtHeightConfirmed(height);
      if (hash) {
        pRevealed.blockHash = hash;
        pRevealed.confirmedBy = confirmedBy;
        await pComputeLive(hash);
        return;
      }
    } catch (err) {
      if (status) status.textContent = `Blok sorgulanamadı: ${err.message} — tekrar denenecek.`;
    }
    // Sıçramalı bekleme: yüzlerce ziyaretçi aynı anda ücretsiz API'yi dövmesin.
    await pSleep(20000 + Math.random() * 20000);
  }
  const retry = pEl('watch-retry');
  if (retry) retry.classList.remove('hidden');
  pWatching = false;
}

const pSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pComputeLive(blockHash) {
  const list = await fetch('katilimcilar.txt').then((r) => r.text());
  const handles = list.split('\n').filter(Boolean);
  const out = await runDraw({
    handles,
    blockHash,
    winnerCount: pDraw.winnerCount,
    backupCount: pDraw.backupCount,
    commit: pDraw.commit,
  });
  pRevealed.result = out;
  pShow('sonuclandi');
  const banner = pEl('live-banner');
  if (banner) banner.classList.remove('hidden');
  pRenderResult();
}

/* ---------- Sonuç ---------- */
let pRendered = false;

async function pRenderResult() {
  if (pRendered) return;
  pRendered = true;

  const data = pRevealed.result
    ? { ...pDraw, ...pRevealed.result, bitcoin: { ...pDraw.bitcoin, blockHash: pRevealed.blockHash } }
    : pDraw;

  const bh = pEl('f-blockhash');
  if (bh) bh.textContent = data.bitcoin.blockHash || '—';
  const sd = pEl('f-seed');
  if (sd) sd.textContent = data.seed || '—';

  const wbox = pEl('winners');
  if (wbox && data.winners) {
    wbox.innerHTML = '';
    data.winners.forEach((h, i) => wbox.appendChild(pWinnerRow(i + 1, h, true)));
    const bbox = pEl('backups');
    if (bbox && data.backups && data.backups.length) {
      bbox.innerHTML = '';
      data.backups.forEach((h, i) => bbox.appendChild(pWinnerRow(i + 1, h, false)));
      const bs = pEl('backups-section');
      if (bs) bs.classList.remove('hidden');
    }
  }
  if (data.steps && data.seed) await pAnimateSteps(data.steps, data.seed);
}

function pWinnerRow(rank, handle, isWinner) {
  const row = document.createElement('div');
  row.className = 'winner' + (isWinner ? ' top' : '');
  const r = document.createElement('span');
  r.className = 'winner-rank';
  r.textContent = rank + '.';
  const h = document.createElement('a');
  h.className = 'winner-handle';
  h.href = 'https://x.com/' + encodeURIComponent(handle);
  h.rel = 'noopener nofollow';
  h.textContent = '@' + handle;
  const t = document.createElement('span');
  t.className = 'winner-tag';
  t.textContent = isWinner ? 'kazanan' : 'yedek';
  row.append(r, h, t);
  return row;
}

/* ---------- Adım adım matematik ---------- */
async function pAnimateSteps(steps, seed) {
  const box = pEl('steps');
  if (!box) return;
  box.innerHTML = '';
  const key = await seedKey(seed);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const st of steps) {
    // Kayıtlı değeri göstermekle yetinmiyoruz: turu tarayıcıda YENİDEN hesaplayıp
    // kayıtla karşılaştırıyoruz. Animasyon süs değil, canlı kanıt.
    const again = await drawIndexDetailed(key, st.round, st.remaining);
    const ok = again.offset === st.offset && again.value === st.value;

    const el = document.createElement('div');
    el.className = 'step';
    const head = document.createElement('div');
    head.className = 'step-head';
    const round = document.createElement('span');
    round.className = 'step-round';
    round.textContent = `Tur ${st.round + 1} · havuzda ${st.remaining} kişi`;
    const pick = document.createElement('span');
    pick.className = 'step-pick';
    pick.textContent = '@' + st.picked;
    head.append(round, pick);

    const math = document.createElement('div');
    math.className = 'step-math';
    math.textContent =
      `HMAC(tohum, "${st.round}:${st.attempt}") → ilk 6 bayt = ${st.value}\n` +
      `${st.value} mod ${st.remaining} = ${st.offset} → sıradaki konum ${st.swappedWith}`;
    math.style.whiteSpace = 'pre-line';

    const check = document.createElement('div');
    check.className = ok ? 'step-ok' : 'notice bad';
    check.textContent = ok
      ? 'bu turu tarayıcın yeniden hesapladı, kayıtla aynı'
      : 'UYARI: yeniden hesaplama kayıtla uyuşmadı';

    el.append(head, math, check);
    box.appendChild(el);
    if (reduced) el.classList.add('on');
    else {
      await pSleep(420);
      requestAnimationFrame(() => el.classList.add('on'));
    }
  }
}

/* ---------- Başlat ---------- */
pTickClock();
setInterval(pTickClock, 1000);

const retryBtn = pEl('watch-retry');
if (retryBtn) {
  retryBtn.addEventListener('click', () => {
    retryBtn.classList.add('hidden');
    pWatching = false;
    pStartWatching();
  });
}
