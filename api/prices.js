export const config = { runtime: 'edge' };

const PRICES_URL = 'https://raw.githubusercontent.com/WeslyWHGS/COLETOR-DE-PRE-OS-HOTMART/main/hotmart-prices.json';

export default async function handler() {
  try {
    const res = await fetch(PRICES_URL);
    if (!res.ok) throw new Error(`GitHub retornou ${res.status}`);
    const data = await res.text();
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
