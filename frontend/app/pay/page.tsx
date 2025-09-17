'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

/* ---------------- Types for Tap Card SDK v2 ---------------- */
type Brand = 'VISA' | 'MASTERCARD';
type SupportedCards = 'ALL' | 'DEBIT' | 'CREDIT';

interface TokenizeSuccess { id: string }
interface ErrorPayload { message?: string; code?: string }

interface CardUiConfig {
  theme?: string;      // from window.CardSDK.Theme
  locale?: string;     // from window.CardSDK.Locale
  edges?: string;      // from window.CardSDK.Edges
  direction?: string;  // from window.CardSDK.Direction
}
interface CardFieldsConfig { cardHolder: boolean }
interface CardAddonsConfig { displayPaymentBrands: boolean; loader: boolean; saveCard: boolean }
interface CardAcceptanceConfig { supportedBrands: Brand[]; supportedCards: SupportedCards }
interface CardTransactionConfig { amount: number; currency: string } // from window.CardSDK.Currencies

interface CardConfig {
  publicKey: string;
  merchant?: { id: string };
  transaction: CardTransactionConfig;
  acceptance?: CardAcceptanceConfig;
  fields?: CardFieldsConfig;
  addons?: CardAddonsConfig;
  interface?: CardUiConfig; // SDK accesses .theme, so include it
  onReady?: () => void;
  onValidInput?: (data: unknown) => void;
  onInvalidInput?: (data: unknown) => void;
  onError?: (e: ErrorPayload) => void;
  onSuccess?: (data: TokenizeSuccess) => void;
}
interface CardMountHandle { unmount: () => void }
interface CardSDK {
  renderTapCard: (containerId: string, config: CardConfig) => CardMountHandle;
  tokenize: () => void;
  Currencies: Record<string, string>;
  Theme: Record<string, string>;
  Direction: Record<string, string>;
  Edges: Record<string, string>;
  Locale: Record<string, string>;
}
declare global { interface Window { CardSDK?: CardSDK } }
/* ---------------------------------------------------------- */

export default function PayPage() {
  const [amount, setAmount] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(false);
  const [cardReady, setCardReady] = useState<boolean>(false);
  const [cardValid, setCardValid] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [sdkLoaded, setSdkLoaded] = useState<boolean>(false);
  const [invalidInfo, setInvalidInfo] = useState<string>('');

  const unmountCard = useRef<(() => void) | null>(null);
  const onceTokenHandler = useRef<((tokenId: string) => void) | null>(null);
  const loadingTimeout = useRef<number | null>(null);
  const mountTries = useRef<number>(0);

  useEffect(() => {
    if (!sdkLoaded) return;
    tryMountCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkLoaded]);

  function tryMountCard(): void {
    const sdk = window.CardSDK;
    const container = document.getElementById('card-sdk-id');

    if (!sdk || !container) {
      if (mountTries.current < 40) {
        mountTries.current += 1;
        window.setTimeout(tryMountCard, 50);
      } else {
        setErrorMsg('Payment SDK not ready. Check network/CSP.');
      }
      return;
    }

    if (unmountCard.current) return;

    const pk = process.env.NEXT_PUBLIC_TAP_PUBLIC_KEY;
    const merchantId = process.env.NEXT_PUBLIC_TAP_MERCHANT_ID;
    if (!pk) {
      setErrorMsg('NEXT_PUBLIC_TAP_PUBLIC_KEY is missing');
      return;
    }

    const { renderTapCard, Currencies, Theme, Direction, Edges, Locale } = sdk;

    const cfg: CardConfig = {
      publicKey: pk,
      merchant: merchantId ? { id: merchantId } : undefined,
      transaction: { amount: 1, currency: Currencies.USD }, // display only; real amount comes from state
      acceptance: { supportedBrands: ['VISA', 'MASTERCARD'], supportedCards: 'ALL' },
      fields: { cardHolder: true },
      addons: { displayPaymentBrands: true, loader: true, saveCard: false },
      interface: {
        locale: Locale.EN,
        theme: Theme.LIGHT,
        edges: Edges.CURVED,
        direction: Direction.LTR,
      },
      onReady: () => { setCardReady(true); setErrorMsg(''); },
      onValidInput: () => { setCardValid(true); setInvalidInfo(''); },
      onInvalidInput: (data) => {
        setCardValid(false);
        try {
          setInvalidInfo(JSON.stringify(data));
        } catch {
          setInvalidInfo('invalid input');
        }
      },
      onError: (e) => {
        setLoading(false);
        if (loadingTimeout.current) window.clearTimeout(loadingTimeout.current);
        setErrorMsg(e.message ?? 'Card input error');
      },
      onSuccess: (data) => {
        const tokenId = data.id;
        const cb = onceTokenHandler.current;
        if (tokenId && cb) { onceTokenHandler.current = null; cb(tokenId); }
      },
    };

    const { unmount } = renderTapCard('card-sdk-id', cfg);
    unmountCard.current = unmount;
  }

  async function runAuthorizeCapture(tokenId: string) {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/tap/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        tokenId,
        orderId: `ORD-${Date.now()}`,
        customer: { email: 'buyer@example.com', first_name: 'Test', last_name: 'User' },
        returnPath: '/pay/return',
      }),
    });

    const data: { status?: string; id?: string; transaction_url?: string; error?: string } = await r.json();
    if (!r.ok) throw new Error(data.error ?? 'Authorize failed');

    if (data.status === 'AUTHORIZED' && data.id && !data.transaction_url) {
      const capRes = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/tap/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorizeId: data.id, amount })
      });
      const cap: { status?: string } = await capRes.json();
      alert(cap.status === 'CAPTURED' ? 'Payment successful ✅' : `Capture status: ${cap.status ?? 'UNKNOWN'}`);
      return;
    }

    if (data.transaction_url) {
      window.location.href = data.transaction_url;
    } else {
      setErrorMsg(`Authorize status: ${data.status ?? 'UNKNOWN'} (no 3DS redirect)`);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMsg('');

    if (!window.CardSDK) return setErrorMsg('Payment SDK not loaded');
    if (!cardReady)      return setErrorMsg('Card not ready yet');

    setLoading(true);
    loadingTimeout.current = window.setTimeout(() => {
      setLoading(false);
      setErrorMsg('Timed out while tokenizing. Check network or card fields.');
    }, 15000);

    // Allow tokenization even if not yet "valid" to surface SDK errors
    onceTokenHandler.current = async (tokenId: string) => {
      try {
        await runAuthorizeCapture(tokenId);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Payment error');
      } finally {
        setLoading(false);
        if (loadingTimeout.current) window.clearTimeout(loadingTimeout.current);
      }
    };

    window.CardSDK.tokenize(); // triggers onSuccess/onError
  }

  return (
    <main style={{ maxWidth: 520, margin: '40px auto', fontFamily: 'system-ui' }}>
      {/* Load SDK via Next for reliable timing */}
      <Script
        src="https://tap-sdks.b-cdn.net/card/1.0.2/index.js"
        strategy="afterInteractive"
        onLoad={() => { console.log('[Tap SDK] script loaded'); setSdkLoaded(true); }}
        onError={() => { console.error('[Tap SDK] failed to load'); setErrorMsg('Could not load payment SDK. Check your network/CSP.'); }}
      />

      <h1>Pay (Authorize → 3DS → Capture)</h1>
      <form onSubmit={onSubmit}>
        <label>Amount (USD)</label>
        <input
          type="number"
          step={1}
          min={1}
          value={amount}
          onChange={e => setAmount(Number(e.target.value))}
          style={{ width: '100%', marginBottom: 12, padding: 8 }}
        />

        {/* Card SDK mounts an iframe here */}
        <div
          id="card-sdk-id"
          style={{
            border: '1px solid #ddd',
            padding: 12,
            borderRadius: 8,
            marginBottom: 12,
            minHeight: 160,
          }}
        />

        <button
          disabled={loading}
          type="submit"
          className="cursor-pointer bg-blue-500 text-white font-medium rounded"
          style={{ padding: '12px 24px', fontSize: 16 }}
        >
          {loading ? 'Processing…' : 'Authorize with 3DS'}
        </button>

        {/* Helpful status line while debugging */}
        <p style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          SDK loaded: {String(sdkLoaded)} | Ready: {String(cardReady)} | Valid: {String(cardValid)}
        </p>
        {invalidInfo && (
          <pre style={{ fontSize: 11, background: '#f7f7f7', padding: 8, borderRadius: 6, overflowX: 'auto' }}>
            onInvalidInput: {invalidInfo}
          </pre>
        )}

        {errorMsg && <p style={{ color: '#b00020', marginTop: 10 }}>{errorMsg}</p>}
      </form>
      <p style={{ marginTop: 12, opacity: 0.7 }}>* Visa/Master only. Currency: USD.</p>
    </main>
  );
}
