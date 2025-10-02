"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface AuthorizeResponse {
  id: string;
  status: string;
  amount?: number;
}

interface CaptureResponse {
  status?: string;
}

export default function ReturnPage() {
  const params = useSearchParams();
  const [msg, setMsg] = useState("Processing payment...");
  const [raw, setRaw] = useState<unknown>(null);

  useEffect(() => {
    const tapId =
      params.get("tap_id") ||
      params.get("id") ||
      params.get("authorize_id");
    const order = params.get("order") || undefined;

    if (!tapId) {
      setMsg("Missing tap id in URL");
      return;
    }

    async function finalize() {
      try {
        setMsg("Verifying authorization...");

        const r = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE}/api/tap/authorize/${encodeURIComponent(
            tapId!
          )}`
        );
        const auth: AuthorizeResponse = await r.json();
        setRaw(auth);

        if (auth.status === "AUTHORIZED") {
          setMsg("Authorized — capturing now...");

          const capRes = await fetch(
            `${process.env.NEXT_PUBLIC_API_BASE}/api/tap/capture`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                authorizeId: auth.id,
                amount: auth.amount,
                orderId: order,
              }),
            }
          );
          const cap: CaptureResponse = await capRes.json();
          setRaw((prev: object) => ({ ...(prev as object), capture: cap }));

          if (cap.status === "CAPTURED") setMsg("Payment successful ✅");
          else setMsg(`Capture status: ${cap.status || "UNKNOWN"}`);
        } else {
          setMsg(`Authorization status: ${auth.status || "UNKNOWN"}`);
        }
      } catch {
        setMsg("Error finalizing payment");
      }
    }
    finalize();
  }, [params]);

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="w-full max-w-xl bg-white p-6 rounded shadow">
        <h1 className="text-lg font-semibold mb-2">{msg}</h1>
        <pre className="text-xs bg-gray-100 p-3 rounded max-h-96 overflow-auto">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </div>
    </main>
  );
}
