/**
 * Bitcoin blok sorgulama — hem tarayıcı hem Node aynı dosyayı kullanır.
 * src/bitcoin.js buradan yeniden dışa aktarır; iki ayrı kopya olsaydı
 * Node ve tarayıcı farklı blok seçebilirdi.
 *
 * Çoklu sağlayıcı zorunlu: mempool.space bu makinenin ağından zaman aşımına
 * uğruyor (Türkiye'de kripto sitelerine ISP engeli yaygın). Tek sağlayıcıya
 * bağlı kalmak, çekilişin en kritik anında sistemi durdurur.
 * blockstream.info'nun tarayıcıdan erişime izin verdiği ölçülerek doğrulandı.
 */
export const PROVIDERS = [
  'https://blockstream.info/api',
  'https://mempool.emzy.de/api',
  'https://mempool.space/api',
];

const TIMEOUT_MS = 8000;

async function fetchOne(url, parse) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 404) return { missing: true };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { value: await parse(res) };
  } finally {
    clearTimeout(timer);
  }
}

async function tryProviders(pathname, parse) {
  const errors = [];
  for (const base of PROVIDERS) {
    try {
      const out = await fetchOne(`${base}${pathname}`, parse);
      if (out.missing) return null;
      return out.value;
    } catch (err) {
      errors.push(`${base}: ${err.message}`);
    }
  }
  throw new Error(`Hiçbir Bitcoin sağlayıcısına ulaşılamadı — ${errors.join(' | ')}`);
}

const asText = (res) => res.text().then((t) => t.trim());
const asJson = (res) => res.json();

export async function currentHeight() {
  return Number(await tryProviders('/blocks/tip/height', asText));
}

/** Belirli yükseklikteki bloğun hash'i; henüz kazılmadıysa null. */
export async function hashAtHeight(height) {
  const hash = await tryProviders(`/block-height/${height}`, asText);
  return hash && /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

/** Blok ayrıntısı: hash, yükseklik, zaman damgası. */
export async function blockAt(height) {
  const hash = await hashAtHeight(height);
  if (!hash) return null;
  const block = await tryProviders(`/block/${hash}`, asJson);
  return block ? { hash, height: block.height, timestamp: block.timestamp } : null;
}

/**
 * Aynı yüksekliğin hash'ini iki BAĞIMSIZ sağlayıcıdan doğrular.
 * Tek bir sağlayıcının yanlış ya da geride kalmış veri vermesine karşı ucuz koruma:
 * kazanan açıklanmadan önce iki kaynağın aynı hash'te uzlaşması beklenir.
 */
export async function hashAtHeightConfirmed(height) {
  const results = [];
  for (const base of PROVIDERS) {
    try {
      const out = await fetchOne(`${base}/block-height/${height}`, asText);
      if (out.missing) return { hash: null, confirmedBy: 0 };
      const hash = out.value;
      if (/^[0-9a-f]{64}$/.test(hash)) results.push({ base, hash });
      if (results.length >= 2) break;
    } catch {
      /* sıradaki sağlayıcıya geç */
    }
  }
  if (results.length === 0) return { hash: null, confirmedBy: 0 };
  if (results.length === 1) return { hash: results[0].hash, confirmedBy: 1 };
  if (results[0].hash !== results[1].hash) {
    throw new Error('Sağlayıcılar farklı hash bildirdi — sonuç açıklanmayacak.');
  }
  return { hash: results[0].hash, confirmedBy: 2 };
}
