export const config = { runtime: 'edge' };

export default function handler(req) {
  const country = req.headers.get('x-vercel-ip-country') ?? 'US';
  return new Response(JSON.stringify({ country }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
