/*
 * Çekiliş sayfasının davranışı.
 *
 * NOT: publish.js bu dosyayı engine.js ve chain.js ile birlikte TEK bir
 * <script> bloğuna gömer. Bu yüzden import yazmaz; yukarıdaki iki dosyanın
 * tanımlarını doğrudan kullanır. İsim çakışmasını önlemek için buradaki her
 * şey "p" öneki taşır.
 */
const pDraw = window.__CEKILIS__;
const pEl = (id) => document.getElementById(id);
const pPad = (n) => String(n).padStart(2, '0');
const pSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pRevealed = { blockHash: null, result: null, confirmedBy: 0 };

const EVRE_ADI = {
  'acik': 'Katılım açık',
  'kilitli': 'Katılım kapandı',
  'blok-bekleniyor': 'Blok bekleniyor',
  'sonuclandi': 'Sonuçlandı',
};

function pPhase(now = Date.now()) {
  if (!pDraw.commit) return 'acik';
  if (pDraw.bitcoin?.blockHash || pRevealed.blockHash) return 'sonuclandi';
  if (now < new Date(pDraw.drawAt).getTime()) return 'kilitli';
  return 'blok-bekleniyor';
}

function pShow(phase) {
  for (const node of document.querySelectorAll('[data-phase]')) {
    node.classList.toggle('gizli', !node.dataset.phase.split(' ').includes(phase));
  }
  const ad = pEl('evre-ad');
  if (ad && EVRE_ADI[phase]) ad.textContent = EVRE_ADI[phase];
}

/* ---------- ikon ---------- */
function pIkon(d, opts = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', opts.w ?? '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}
const IKON_ONAY = 'M20 6 9 17l-5-5';

/* ---------- geri sayım ---------- */
function pTick() {
  const phase = pPhase();
  pShow(phase);

  const box = pEl('clock');
  if (box) {
    const hedef = phase === 'acik' ? (pDraw.lockAt || pDraw.drawAt) : pDraw.drawAt;
    if (hedef) {
      const kalan = Math.max(0, new Date(hedef).getTime() - Date.now());
      const s = Math.floor(kalan / 1000);
      const hucre = box.querySelectorAll('.saat-sayi');
      if (hucre.length === 3) {
        hucre[0].textContent = pPad(Math.floor(s / 3600));
        hucre[1].textContent = pPad(Math.floor((s % 3600) / 60));
        hucre[2].textContent = pPad(s % 60);
      }
    }
  }

  if (phase === 'blok-bekleniyor') pIzlemeBaslat();
  if (phase === 'sonuclandi') pSonucCiz();
}

/* ---------- blok bekleme, canlı açılış ---------- */
let pIzliyor = false;
let pDurmaAni = 0;

function pIzlemeBaslat() {
  if (pIzliyor) return;
  pIzliyor = true;
  pDurmaAni = Date.now() + 2 * 60 * 60 * 1000;
  pIzlemeDongusu();
}

async function pIzlemeDongusu() {
  const height = pDraw.bitcoin.targetHeight;
  const durum = pEl('watch-status');

  while (Date.now() < pDurmaAni) {
    if (document.visibilityState === 'hidden') { await pSleep(5000); continue; }
    try {
      const tip = await currentHeight();
      if (durum) {
        const uzak = Math.max(0, height - tip);
        durum.textContent = uzak === 0
          ? 'Blok kazıldı, sonuç hesaplanıyor…'
          : `Hedef blok ${height} · şu anki yükseklik ${tip} · yaklaşık ${uzak * 10} dakika`;
      }
      const { hash, confirmedBy } = await hashAtHeightConfirmed(height);
      if (hash) {
        pRevealed.blockHash = hash;
        pRevealed.confirmedBy = confirmedBy;
        await pCanliHesapla(hash);
        return;
      }
    } catch (err) {
      if (durum) durum.textContent = `Blok sorgulanamadı: ${err.message} — tekrar denenecek.`;
    }
    // Sıçramalı bekleme: yüzlerce ziyaretçi aynı anda ücretsiz API'yi dövmesin.
    await pSleep(20000 + Math.random() * 20000);
  }
  pEl('watch-retry')?.classList.remove('gizli');
  pIzliyor = false;
}

async function pCanliHesapla(blockHash) {
  const liste = await fetch('katilimcilar.txt').then((r) => r.text());
  pRevealed.result = await runDraw({
    handles: liste.split('\n').filter(Boolean),
    blockHash,
    winnerCount: pDraw.winnerCount,
    backupCount: pDraw.backupCount,
    commit: pDraw.commit,
  });
  pShow('sonuclandi');
  pEl('live-banner')?.classList.remove('gizli');
  pSonucCiz();
}

/* ---------- sonuç ---------- */
let pCizildi = false;

async function pSonucCiz() {
  if (pCizildi) return;
  pCizildi = true;

  const d = pRevealed.result
    ? { ...pDraw, ...pRevealed.result, bitcoin: { ...pDraw.bitcoin, blockHash: pRevealed.blockHash } }
    : pDraw;

  const bh = pEl('f-blockhash');
  if (bh) bh.textContent = d.bitcoin?.blockHash || '—';
  const sd = pEl('f-seed');
  if (sd) sd.textContent = d.seed || '—';

  const kutu = pEl('winners');
  if (kutu && d.winners) {
    kutu.replaceChildren(...d.winners.map((h, i) => pKazananSatir(i + 1, h, true)));
    if (d.backups?.length) {
      pEl('backups')?.replaceChildren(...d.backups.map((h, i) => pKazananSatir(i + 1, h, false)));
      pEl('backups-section')?.classList.remove('gizli');
    }
  }
  if (d.steps && d.seed) await pAdimlariCiz(d.steps, d.seed);
}

function pKazananSatir(sira, handle, kazanan) {
  const row = document.createElement('div');
  row.className = 'kazanan' + (kazanan ? ' birinci' : '');
  const s = document.createElement('span');
  s.className = 'kazanan-sira';
  s.textContent = sira;
  const a = document.createElement('a');
  a.className = 'kazanan-ad';
  a.href = 'https://x.com/' + encodeURIComponent(handle);
  a.rel = 'noopener nofollow';
  a.textContent = '@' + handle;
  const e = document.createElement('span');
  e.className = 'kazanan-etiket';
  e.textContent = kazanan ? 'kazanan' : 'yedek';
  row.append(s, a, e);
  return row;
}

/* ---------- adım adım matematik ---------- */
async function pAdimlariCiz(steps, seed) {
  const kutu = pEl('steps');
  if (!kutu) return;
  kutu.replaceChildren();
  const key = await seedKey(seed);
  const azalt = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const st of steps) {
    // Kayıtlı değeri göstermekle yetinmiyoruz: turu tarayıcıda YENİDEN hesaplayıp
    // kayıtla karşılaştırıyoruz. Animasyon süs değil, canlı kanıt.
    const tekrar = await drawIndexDetailed(key, st.round, st.remaining);
    const uygun = tekrar.offset === st.offset && tekrar.value === st.value;

    const el = document.createElement('div');
    el.className = 'adim';

    const bas = document.createElement('div');
    bas.className = 'adim-bas';
    const tur = document.createElement('span');
    tur.className = 'adim-tur';
    tur.textContent = `Tur ${st.round + 1} · havuzda ${st.remaining} kişi`;
    const sec = document.createElement('span');
    sec.className = 'adim-secilen';
    sec.textContent = '@' + st.picked;
    bas.append(tur, sec);

    const mat = document.createElement('div');
    mat.className = 'adim-mat';
    mat.textContent =
      `HMAC(tohum, "${st.round}:${st.attempt}") → ilk 6 bayt = ${st.value}\n` +
      `${st.value} mod ${st.remaining} = ${st.offset} → konum ${st.swappedWith}`;

    const onay = document.createElement('div');
    if (uygun) {
      onay.className = 'adim-onay';
      onay.append(pIkon(IKON_ONAY), document.createTextNode('bu turu tarayıcın yeniden hesapladı, kayıtla aynı'));
    } else {
      onay.className = 'uyari kotu';
      onay.textContent = 'UYARI: yeniden hesaplama kayıtla uyuşmadı';
    }

    el.append(bas, mat, onay);
    kutu.appendChild(el);
    if (azalt) el.classList.add('acik');
    else {
      await pSleep(380);
      requestAnimationFrame(() => el.classList.add('acik'));
    }
  }
}

/* ---------- tema ---------- */
(() => {
  const dugme = pEl('tema');
  const uygula = (v) => {
    document.body.dataset.theme = v;
    try { localStorage.setItem('tema', v); } catch (e) { /* özel mod */ }
  };
  try { uygula(localStorage.getItem('tema') || 'dark'); } catch (e) { /* özel mod */ }
  dugme?.addEventListener('click', () =>
    uygula(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
})();

/* ---------- başlat ---------- */
pTick();
setInterval(pTick, 1000);
pEl('watch-retry')?.addEventListener('click', (e) => {
  e.target.classList.add('gizli');
  pIzliyor = false;
  pIzlemeBaslat();
});
