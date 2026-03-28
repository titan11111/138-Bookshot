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
          ok: Boolean(env.ANTHROPIC_API_KEY),
          mode: 'cloudflare-worker',
          hasApiKey: Boolean(env.ANTHROPIC_API_KEY),
          message: env.ANTHROPIC_API_KEY
            ? 'BookShot Worker is ready.'
            : 'ANTHROPIC_API_KEY is not configured.'
        },
        env.ANTHROPIC_API_KEY ? 200 : 503,
        corsHeaders
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/test') {
      if (!env.ANTHROPIC_API_KEY) {
        return jsonResponse(
          { error: { message: 'ANTHROPIC_API_KEY is not configured.' } },
          503,
          corsHeaders
        );
      }

      return proxyAnthropic(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'hi' }]
        },
        env,
        corsHeaders
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      if (!env.ANTHROPIC_API_KEY) {
        return jsonResponse(
          { error: { message: 'ANTHROPIC_API_KEY is not configured.' } },
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

      return proxyAnthropic(
        {
          model: 'claude-opus-4-6',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: body.mediaType || 'image/jpeg',
                  data: body.imageBase64
                }
              },
              {
                type: 'text',
                text: body.prompt || ''
              }
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

async function proxyAnthropic(payload, env, corsHeaders) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'content-type': 'application/json; charset=utf-8'
      }
    });
  } catch (error) {
    return jsonResponse(
      { error: { message: 'Anthropic request failed: ' + error.message } },
      502,
      corsHeaders
    );
  }
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = (env.ALLOWED_ORIGINS ||
    'https://titan11111.github.io,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8787'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const allowOrigin = allowedOrigins.includes(origin)
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
