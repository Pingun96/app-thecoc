const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type PushBody = {
  subscriptionIds?: string[];
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
};

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json',
  },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const appId = Deno.env.get('ONESIGNAL_APP_ID');
  const restApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY');

  if (!appId || !restApiKey) {
    return jsonResponse({ error: 'Missing OneSignal server configuration' }, 500);
  }

  let body: PushBody;
  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const subscriptionIds = [...new Set((body.subscriptionIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];

  if (!subscriptionIds.length) {
    return jsonResponse({ sent: 0, skipped: true, reason: 'No subscription IDs' });
  }

  const title = body.title || 'The Cốc';
  const message = body.body || '';

  const oneSignalResponse = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Basic ${restApiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_subscription_ids: subscriptionIds,
      headings: { en: title, vi: title },
      contents: { en: message, vi: message },
      data: body.data || {},
    }),
  });

  const result = await oneSignalResponse.json().catch(() => null);

  if (!oneSignalResponse.ok) {
    return jsonResponse({
      error: 'OneSignal request failed',
      status: oneSignalResponse.status,
      details: result,
    }, 502);
  }

  return jsonResponse({
    sent: subscriptionIds.length,
    provider: 'onesignal',
    id: result?.id || null,
    recipients: result?.recipients ?? subscriptionIds.length,
  });
});
