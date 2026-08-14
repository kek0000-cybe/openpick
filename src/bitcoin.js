/**
 * Node tarafı, tarayıcıyla AYNI blok sorgulama kodunu kullanır.
 * Ayrı kopya tutmak, iki tarafın farklı blok seçmesi riskini doğururdu.
 */
export {
  PROVIDERS,
  currentHeight,
  hashAtHeight,
  blockAt,
  hashAtHeightConfirmed,
} from '../web/lib/chain.js';
