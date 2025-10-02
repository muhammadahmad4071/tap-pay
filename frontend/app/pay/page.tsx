"use client";

import { useState } from "react";

interface AuthorizeResponse {
  id: string;
  status: string;
  transaction_url?: string;
  amount?: number;
  reference?: { transaction?: string };
  error?: string;
}

interface CaptureResponse {
  status?: string;
  error?: string;
}

export default function HomePage() {
  const [amount, setAmount] = useState<number>(10);
  const [name, setName] = useState<string>("Test User");
  const [cardNumber, setCardNumber] = useState<string>("5123450000000008");
  const [expMonth, setExpMonth] = useState<string>("11");
  const [expYear, setExpYear] = useState<string>("25");
  const [cvc, setCvc] = useState<string>("100");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/tap/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          currency: "USD",
          orderId: `ORD-${Date.now()}`,
          customer: {
            first_name: name.split(" ")[0] || "Test",
            last_name: name.split(" ").slice(1).join(" ") || "User",
            email: "buyer@example.com",
          },
          card: {
            number: cardNumber,
            exp_month: Number(expMonth),
            exp_year: Number(expYear),
            cvc,
            name,
          },
          returnPath: "/pay/return",
        }),
      });

      const data: AuthorizeResponse = await res.json();
      if (!res.ok) throw new Error(data.error || "Authorize failed");

      if (data.transaction_url) {
        // 3DS required
        window.location.href = data.transaction_url;
      } else if (data.status === "AUTHORIZED" && data.id) {
        // No 3DS required — capture immediately
        setMessage("Authorized (no 3DS). Capturing...");

        const capRes = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/tap/capture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authorizeId: data.id,
            amount: data.amount || amount,
            orderId: data.reference?.transaction,
          }),
        });

        const cap: CaptureResponse = await capRes.json();
        if (cap.status === "CAPTURED") {
          setMessage("Payment successful ✅");
        } else {
          setMessage(`Capture status: ${cap.status || cap.error || "UNKNOWN"}`);
        }
      } else {
        setMessage(`Authorize status: ${data.status || "UNKNOWN"}`);
      }
    } catch (err) {
      if (err instanceof Error) setMessage(err.message);
      else setMessage("Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="w-full max-w-md bg-white p-6 rounded shadow">
        <h1 className="text-xl font-semibold mb-4">Pay (Server-to-Server)</h1>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            Amount (USD)
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full border p-2 rounded"
            />
          </label>

          <label className="block">
            Cardholder name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border p-2 rounded"
            />
          </label>

          <label className="block">
            Card number
            <input
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              className="w-full border p-2 rounded"
            />
          </label>

          <div className="flex gap-2">
            <input
              value={expMonth}
              onChange={(e) => setExpMonth(e.target.value)}
              className="w-1/3 border p-2 rounded"
              placeholder="MM"
            />
            <input
              value={expYear}
              onChange={(e) => setExpYear(e.target.value)}
              className="w-1/3 border p-2 rounded"
              placeholder="YY"
            />
            <input
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
              className="w-1/3 border p-2 rounded"
              placeholder="CVC"
            />
          </div>

          <button
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded"
          >
            {loading ? "Processing..." : "Pay"}
          </button>
        </form>

        {message && <p className="mt-4 text-sm">{message}</p>}
        <p className="mt-4 text-xs text-gray-500">
          Note: No Tap SDK used. Card details posted to backend (sandbox). Use test cards only.
        </p>
      </div>
    </main>
  );
}
