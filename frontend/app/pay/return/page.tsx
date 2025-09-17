'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Auth = {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  [k: string]: unknown;
};

type Capture = {
  id?: string;       // chg_xxx
  status?: string;   // CAPTURED / DECLINED
  amount?: number;
  currency?: string;
  [k: string]: unknown;
};

export default function ReturnPage() {
  const params = useSearchParams();
  const [msg, setMsg] = useState('Finalizing…');
  const [auth, setAuth] = useState<Auth | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const authId = params.get('id') || params.get('tap_id') || params.get('auth_id');
    const order  = params.get('order') || 'NA';

    async function finalize() {
      try {
        if (!authId) {
          setMsg('Missing authorization id.');
          return;
        }

        // 1) Re-fetch the authorization to be sure 3DS completed
        const r1 = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/tap/authorize/${authId}`);
        const authJson: Auth = await r1.json();
        setAuth(authJson);

        if (authJson?.status === 'AUTHORIZED') {
          // 2) Capture once (idempotent header helps if user refreshes)
          const r2 = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/tap/capture`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': `cap-${authId}`, // optional: backend can forward to Tap
            },
            body: JSON.stringify({
              authorizeId: authJson.id,
              amount: authJson.amount || 1,
              orderId: order,
            }),
          });
          const capJson: Capture = await r2.json();
          setCapture(capJson);

          if (capJson?.status === 'CAPTURED') {
            setMsg('Payment successful ✅');
          } else {
            setMsg(`Capture status: ${capJson?.status || 'UNKNOWN'}`);
          }
        } else {
          setMsg(`Authorization status: ${authJson?.status || 'UNKNOWN'}`);
        }
      } catch (e) {
        setMsg('Error finalizing payment.');
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    finalize();
  }, [params]);

  return (
    <main style={{ maxWidth: 620, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1 style={{ marginBottom: 8 }}>{msg}</h1>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}

      <h2 style={{ marginTop: 16 }}>Authorization</h2>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f6f6', padding: 12, borderRadius: 8 }}>
        {JSON.stringify(auth, null, 2)}
      </pre>

      {capture && (
        <>
          <h2>Capture</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f6f6', padding: 12, borderRadius: 8 }}>
            {JSON.stringify(capture, null, 2)}
          </pre>
        </>
      )}

      <a href="/pay">Back</a>
    </main>
  );
}
