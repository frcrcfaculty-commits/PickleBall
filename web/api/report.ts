// POST /api/report — stores one spike.html device report in Supabase.
// No secret key: inserts go through the SECURITY DEFINER function
// public.submit_device_report (table itself has RLS on, no policies).
const MAX_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return json({ error: 'server not configured' }, 500);

  const body = await request.text();
  if (body.length > MAX_BYTES) return json({ error: 'body too large' }, 413);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return json({ error: 'invalid json' }, 400); }
  if (!parsed || typeof parsed !== 'object') return json({ error: 'expected object' }, 400);

  // Accept either {ua, report} or a raw report object (what spike.html posts).
  const obj = parsed as Record<string, unknown>;
  const report = 'report' in obj && typeof obj.report === 'object' ? obj.report : obj;
  const ua = typeof obj.ua === 'string' ? obj.ua : request.headers.get('user-agent') ?? '';

  const res = await fetch(`${url}/rest/v1/rpc/submit_device_report`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_ua: ua, p_report: report }),
  });
  if (!res.ok) return json({ error: 'insert failed', status: res.status }, 502);
  return json({ id: await res.json() }, 201);
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
