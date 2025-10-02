import express from "express";
import cors from "cors";
import axios, { AxiosError } from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Allow CORS (use ALLOWED_ORIGINS env to restrict)
const ALLOWED = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: ALLOWED.length ? ALLOWED : true, credentials: true }));

// NOTE: webhook needs raw body for signature verification, register webhook route BEFORE express.json()
app.post("/api/tap/webhook", express.raw({ type: "*/*" }), (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
    let evt = null;
    try { evt = JSON.parse(raw); } catch (e) { /* not JSON */ }

    // OPTIONAL: verify signature header here if Tap provides one (recommended in prod)
    // const signature = req.header('Tap-Signature') || req.header('tap-signature');
    // verifySignature(raw, signature, process.env.TAP_WEBHOOK_SECRET);

    console.log("[WEBHOOK] event:", evt || raw);

    // TODO: update your DB/order state based on evt (evt.object, evt.status, evt.id, ...)
    res.status(200).send("ok");
  } catch (err) {
    console.error("webhook error:", err);
    res.status(500).send("error");
  }
});

// Now parse JSON for normal endpoints
app.use(express.json());

const TAP_API_BASE = process.env.TAP_API_BASE || "https://api.tap.company/v2";
const TAP_SECRET_KEY = process.env.TAP_SECRET_KEY;
const TAP_MERCHANT_ID = process.env.TAP_MERCHANT_ID;
const WEB_BASE_URL = process.env.WEB_BASE_URL || "http://localhost:3000";

if (!TAP_SECRET_KEY) {
  console.error("Missing TAP_SECRET_KEY in env");
  process.exit(1);
}

function tapHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${TAP_SECRET_KEY}`,
    ...extra
  };
}

/**
 * Create token from raw card details (server-side)
 * POST /api/tap/token
 * body: { card, client_ip? }
 */
app.post("/api/tap/token", async (req, res) => {
  try {
    const { card, client_ip } = req.body || {};
    if (!card || !card.number) return res.status(400).json({ error: "card required" });

    const r = await axios.post(`${TAP_API_BASE}/tokens`, { card, client_ip }, { headers: tapHeaders() });
    return res.status(r.status).json(r.data);
  } catch (error) {
        const err = error as AxiosError<any>;

    console.error("token_error:", err?.response?.data || err.message || err);
    if (err?.response) return res.status(err.response.status).json(err.response.data);
    res.status(500).json({ error: "token_failed", detail: String(err?.message || err) });
  }
});

/**
 * Authorize (3DS) — combined flow (accept tokenId or raw card)
 * POST /api/tap/authorize
 * body: { amount, currency?, orderId?, tokenId?, card?, customer?, returnPath? }
 *
 * Returns: { ok, status, id, transaction_url, amount, raw }
 */
app.post("/api/tap/authorize", async (req, res) => {
  try {
    const { amount = 1, currency = "USD", orderId, tokenId, card, customer, returnPath } = req.body || {};
    const amt = Number(amount);
    if (!(amt > 0)) return res.status(400).json({ error: "Invalid amount" });

    // if raw card provided, create token first
    let token = tokenId;
    if (!token && card) {
      const rtok = await axios.post(`${TAP_API_BASE}/tokens`, { card }, { headers: tapHeaders() });
      if (!rtok?.data?.id) return res.status(rtok.status || 500).json(rtok.data || { error: "token_creation_failed" });
      token = rtok.data.id;
    }

    if (!token) return res.status(400).json({ error: "tokenId or card required" });

    const redirectUrl = new URL(returnPath || "/pay/return", WEB_BASE_URL);
    if (orderId) redirectUrl.searchParams.set("order", String(orderId));

    const body = {
      amount: amt,
      currency,
      threeDSecure: true,
      save_card: false,
      description: `Order ${orderId || ""}`.trim(),
      statement_descriptor: "Sample Auth",
      merchant: { id: TAP_MERCHANT_ID },
      customer: {
        first_name: customer?.first_name || "NA",
        last_name: customer?.last_name || "NA",
        email: customer?.email || "na@example.com",
      },
      source: { id: token },
      redirect: { url: redirectUrl.toString() },
      reference: { transaction: orderId || `txn_${Date.now()}` },
    };

    const r = await axios.post(`${TAP_API_BASE}/authorize`, body, { headers: tapHeaders() });

    // return centralized response even if status indicates failure on remote side
    return res.status(r.status).json({
      ok: r.status >= 200 && r.status < 300,
      status: r.data?.status,
      id: r.data?.id,
      amount: r.data?.amount,
      transaction_url: r.data?.transaction?.url || null,
      raw: r.data,
    });
  } catch (error) {
        const err = error as AxiosError<any>;

    console.error("authorize_error:", err?.response?.data || err.message || err);
    if (err?.response) return res.status(err.response.status).json(err.response.data);
    return res.status(500).json({ error: "authorize_failed", detail: String(err?.message || err) });
  }
});

/**
 * Capture — create a charge using authorize_id as source
 * POST /api/tap/capture
 * body: { authorizeId, amount?, orderId? }
 *
 * Returns { ok, status, id, raw }
 */
app.post("/api/tap/capture", async (req, res) => {
  try {
    const { authorizeId, amount = 1, orderId } = req.body || {};
    if (!authorizeId) return res.status(400).json({ error: "authorizeId required" });

    const body = {
      amount: Number(amount),
      currency: "USD",
      merchant: { id: TAP_MERCHANT_ID },
      source: { id: authorizeId },
      description: `Capture for ${orderId || authorizeId}`,
    };

    const idempotencyKey = req.header("Idempotency-Key") || `cap-${authorizeId}`;

    const r = await axios.post(`${TAP_API_BASE}/charges`, body, { headers: tapHeaders({ "Idempotency-Key": idempotencyKey }) });

    return res.status(r.status).json({
      ok: r.status >= 200 && r.status < 300,
      status: r.data?.status,
      id: r.data?.id,
      raw: r.data,
    });
  } catch (error) {
        const err = error as AxiosError<any>;

    console.error("capture_error:", err?.response?.data || err.message || err);
    if (err?.response) return res.status(err.response.status).json(err.response.data);
    return res.status(500).json({ error: "capture_failed", detail: String(err?.message || err) });
  }
});

/**
 * Fetch authorize by id
 * GET /api/tap/authorize/:id
 */
app.get("/api/tap/authorize/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "id required" });

    const r = await axios.get(`${TAP_API_BASE}/authorize/${encodeURIComponent(id)}`, { headers: tapHeaders() });
    return res.status(r.status).json(r.data);
  } catch (error) {
        const err = error as AxiosError<any>;
    console.error("fetch_authorize_error:", err?.response?.data || err.message || err);
    if (err?.response) return res.status(err.response.status).json(err.response.data);
    return res.status(500).json({ error: "fetch_authorize_failed", detail: String(err?.message || err) });
  }
});

// simple root
app.get("/", (req, res) => res.send("Tap server-to-server backend running"));

// start
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
