export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(
        {
          ok: Boolean(env.GEMINI_API_KEY),
          mode: 'cloudflare-worker',
          hasApiKey: Boolean(env.GEMINI_API_KEY),
          message: env.GEMINI_API_KEY
            ? 'BookShot Worker is ready (Gemini).'
            : 'GEMINI_API_KEY is not configured.'
        },
        env.GEMINI_API_KEY ? 200 : 503,
        corsHeaders
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/test') {
      if (!env.GEMINI_API_KEY) {
        return jsonResponse(
          { error: { message: 'GEMINI_API_KEY is not configured.' } },
          503,
          corsHeaders
        );
      }

      return proxyGemini(
        {
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
        },
        env,
        corsHeaders
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      if (!env.GEMINI_API_KEY) {
        return jsonResponse(
          { error: { message: 'GEMINI_API_KEY is not configured.' } },
          503,
          corsHeaders
        );
      }

      let body;
      try {
        body = await request.json();
      } catch (error) {
        return jsonResponse(
          { error: { message: 'Request JSON is invalid: ' + error.message } },
          400,
          corsHeaders
        );
      }

      if (!body.imageBase64) {
        return jsonResponse(
          { error: { message: 'imageBase64 is required.' } },
          400,
          corsHeaders
        );
      }

      return proxyGemini(
        {
          contents: [{
            role: 'user',
            parts: [
              {
                inline_data: {
                  mime_type: body.mediaType || 'image/jpeg',
                  data: body.imageBase64
                }
              },
              { text: body.prompt || '' }
            ]
          }]
        },
        env,
        corsHeaders
      );
    }

    return jsonResponse({ error: { message: 'Not found' } }, 404, corsHeaders);
  }
};

async function proxyGemini(payload, env, corsHeaders) {
  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const geminiData = await response.json();

    if (!response.ok) {
      return jsonResponse(
        { error: { message: geminiData?.error?.message || 'Gemini API error' } },
        response.status,
        corsHeaders
      );
    }

    // Gemini のレスポンスをフロントが期待する形式に変換
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return jsonResponse(
      { content: [{ type: 'text', text }] },
      200,
      corsHeaders
    );
  } catch (error) {
    return jsonResponse(
      { error: { message: 'Gemini request failed: ' + error.message } },
      502,
      corsHeaders
    );
  }
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = (env.ALLOWED_ORIGINS ||
    'https://titan11111.github.io,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8787,http://127.0.0.1:5500,http://localhost:5500'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  // 許可リストに含まれるか、ローカル開発用ループバックならそのまま返す
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowOrigin = allowedOrigins.includes(origin)
    ? origin
    : isLocalhost
      ? origin
      : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function jsonResponse(payload, status, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8'
    }
  });
}
