import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();

// CORS
const allowed = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({ origin: allowed.length ? allowed : true, credentials: true }));

const TAP_API_BASE = process.env.TAP_API_BASE!;
const TAP_SECRET_KEY = process.env.TAP_SECRET_KEY!;
const TAP_MERCHANT_ID = process.env.TAP_MERCHANT_ID!;
const WEB_BASE_URL = process.env.WEB_BASE_URL!;

function tapHeaders(extra: Record<string, string> = {}) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TAP_SECRET_KEY}`,
    ...extra
  };
}

/**
 *  A) Webhook — register BEFORE express.json()
 *  If we later verify signatures, we will need the *raw* body.
 *  Keeping this route first so express.json() doesn’t consume the stream.
 */
app.post('/api/tap/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
    let evt: any = null;
    try { evt = JSON.parse(raw); } catch { /* keep raw if not JSON */ }

    // TODO: If Tap exposes a signature header in your account,
    // verify HMAC against the *raw* body here before trusting.
    // Then upsert payment status to your DB (evt?.object?.id, evt?.object?.status).

    res.status(200).send('ok');
  } catch (e) {
    console.error('webhook error', e);
    res.status(400).send('bad');
  }
});

app.use(express.json());

/**
 * B) Create Authorize (3DS)
 */
app.post('/api/tap/authorize', async (req, res) => {
  try {
    const { amount, orderId, tokenId, customer, returnPath } = req.body || {};
    if (!tokenId) return res.status(400).json({ error: 'tokenId required' });

    const amt = Number(amount || 1);
    if (!(amt > 0)) return res.status(400).json({ error: 'Invalid amount' });

    const redirectUrl = new URL(returnPath || '/pay/return', WEB_BASE_URL);
    if (orderId) redirectUrl.searchParams.set('order', String(orderId));

    const body = {
      amount: amt,
      currency: 'USD',
      threeDSecure: true,
      description: `Order ${orderId || ''}`.trim(),
      statement_descriptor: 'Sample Auth',
      merchant: { id: TAP_MERCHANT_ID },
      customer: {
        first_name: customer?.first_name || 'NA',
        last_name:  customer?.last_name  || 'NA',
        email:      customer?.email      || 'na@example.com',
        phone: customer?.phone ? { country_code: '1', number: customer.phone } : undefined,
      },
      source: { id: tokenId },                 // token from Tap Web SDK
      redirect: { url: redirectUrl.toString() } // 3DS return
    };

    const r = await fetch(`${TAP_API_BASE}/authorize`, {
      method: 'POST',
      headers: tapHeaders(),
      body: JSON.stringify(body),
    });
    const data: any = await r.json();
console.log(data.transaction.url,'url');
    return res.status(r.status).json({
      ok: r.ok,
      status: data?.status,                 // e.g., INITIATED / AUTHORIZED
      id: data?.id,                         // auth_xxx
      transaction_url: data?.transaction?.url || null,
      raw: data,
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: 'authorize_failed', detail: e?.message });
  }
});

/**
 * C) Capture an authorization (server-to-server)
 *    Per Tap docs, use Charges API with source.id = authorize_id
 */

app.post('/api/tap/capture', async (req, res) => {
  try {
    const { authorizeId, amount, orderId } = req.body || {};
    if (!authorizeId) return res.status(400).json({ error: 'authorizeId required' });
    const amt = Number(amount || 1);

    const body = {
      amount: amt,
      currency: 'USD',
      merchant: { id: TAP_MERCHANT_ID },
      source: { id: authorizeId },
      description: `Capture for ${orderId || authorizeId}`,
    };

    const idemp = req.header('Idempotency-Key') || `cap-${authorizeId}`;
    const r = await fetch(`${TAP_API_BASE}/charges`, {
      method: 'POST',
      headers: tapHeaders({ 'Idempotency-Key': idemp }),
      body: JSON.stringify(body),
    });

    const data: any = await r.json();
    console.log('[CAPTURE]', r.status, data?.status, data?.id, 'for auth', authorizeId);

    return res.status(r.status).json({
      ok: r.ok,
      status: data?.status,
      id: data?.id,
      raw: data,
    });
  } catch (e: any) {
    console.error('capture_failed', e);
    res.status(500).json({ error: 'capture_failed', detail: e?.message });
  }
});


/**
 * D) Fetch an authorization by id — used by /pay/return
 */
app.get('/api/tap/authorize/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await fetch(`${TAP_API_BASE}/authorize/${encodeURIComponent(id)}`, {
      headers: tapHeaders(),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e: any) {
    res.status(500).json({ error: 'fetch_authorize_failed', detail: e?.message });
  }
});

app.listen(process.env.PORT || 4000, () => {
  console.log(`Server on :${process.env.PORT || 4000}`);
});
