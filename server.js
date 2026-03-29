/**
 * BookShot — ローカルプロキシサーバー
 * Node.js 標準ライブラリのみ使用（npm install 不要）
 *
 * 起動方法: GEMINI_API_KEY=... node server.js
 * ブラウザで開く: http://localhost:3000
 *
 * 役割:
 *   ブラウザ → localhost:3000/api/analyze → generativelanguage.googleapis.com
 *   ※ ブラウザからは同一オリジン通信なので CORS なし
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT    = 3000;
const DIR     = __dirname;
const API_KEY = process.env.GEMINI_API_KEY || '';

const GEMINI_HOSTNAME = 'generativelanguage.googleapis.com';
const GEMINI_MODEL    = 'gemini-1.5-flash';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function geminiPathFor(model) {
  return `/v1beta/models/${model}:generateContent?key=${API_KEY}`;
}

/* ── Gemini のレスポンスをフロントが期待する形式に変換 ── */
function toFrontendFormat(geminiBody) {
  try {
    const parsed = JSON.parse(geminiBody);
    if (parsed.error) return { error: parsed.error };
    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return { error: { message: 'レスポンスの解析に失敗しました: ' + e.message } };
  }
}

/* ═══════════════════════════════════════════════════════
   ルーター
═══════════════════════════════════════════════════════ */
const server = http.createServer((req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET / → index.html を返す
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(DIR, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html が見つかりません: ' + err.message);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // ── GET /health → サービス状態確認
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, API_KEY ? 200 : 503, {
      ok: !!API_KEY,
      mode: 'local-proxy',
      hasApiKey: !!API_KEY,
      message: API_KEY
        ? 'BookShot local proxy is ready (Gemini).'
        : 'GEMINI_API_KEY が未設定です。'
    });
    return;
  }

  // ── POST /api/analyze → Gemini API へプロキシ
  if (req.method === 'POST' && req.url === '/api/analyze') {
    if (!API_KEY) {
      sendJson(res, 503, { error: { message: 'GEMINI_API_KEY が未設定です' } });
      return;
    }

    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(rawBody); }
      catch (e) {
        sendJson(res, 400, { error: { message: 'リクエストのJSONが不正です: ' + e.message } });
        return;
      }

      const { imageBase64, mediaType, prompt } = parsed;
      if (!imageBase64) {
        sendJson(res, 400, { error: { message: 'imageBase64 が指定されていません' } });
        return;
      }

      const geminiBody = JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { text: prompt || '' }
          ]
        }]
      });

      const options = {
        hostname: GEMINI_HOSTNAME,
        port:     443,
        path:     geminiPathFor(GEMINI_MODEL),
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(geminiBody)
        }
      };

      console.log(`[${new Date().toLocaleTimeString()}] Gemini API へリクエスト送信...`);

      const apiReq = https.request(options, (apiRes) => {
        let responseBody = '';
        apiRes.on('data', chunk => { responseBody += chunk; });
        apiRes.on('end', () => {
          console.log(`[${new Date().toLocaleTimeString()}] レスポンス受信: HTTP ${apiRes.statusCode}`);
          const converted = toFrontendFormat(responseBody);
          sendJson(res, apiRes.statusCode || 500, converted);
        });
      });

      apiReq.on('error', (e) => {
        console.error('Gemini API 通信エラー:', e.message);
        sendJson(res, 502, { error: { message: 'Gemini APIへの接続に失敗: ' + e.message } });
      });

      apiReq.write(geminiBody);
      apiReq.end();
    });
    return;
  }

  // ── POST /api/test → API疎通確認
  if (req.method === 'POST' && req.url === '/api/test') {
    if (!API_KEY) {
      sendJson(res, 503, { error: { message: 'GEMINI_API_KEY が未設定です' } });
      return;
    }

    const testBody = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
    });

    const options = {
      hostname: GEMINI_HOSTNAME,
      port:     443,
      path:     geminiPathFor(GEMINI_MODEL),
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(testBody)
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let body = '';
      apiRes.on('data', c => { body += c; });
      apiRes.on('end', () => {
        const converted = toFrontendFormat(body);
        sendJson(res, apiRes.statusCode, converted);
      });
    });
    apiReq.on('error', (e) => {
      sendJson(res, 502, { error: { message: e.message } });
    });
    apiReq.write(testBody);
    apiReq.end();
    return;
  }

  // ── 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

/* ═══════════════════════════════════════════════════════
   起動
═══════════════════════════════════════════════════════ */
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   BookShot ローカルサーバー 起動中        ║');
  console.log('╠═══════════════════════════════════════════╣');
  console.log(`║   http://localhost:${PORT}  を開いてください  ║`);
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');
  if (!API_KEY) {
    console.log('※ GEMINI_API_KEY が未設定です。');
    console.log('  例: GEMINI_API_KEY=AIza... node server.js');
    console.log('');
  }
  console.log('停止するには Ctrl + C を押してください');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`ポート ${PORT} はすでに使用中です。`);
    console.error('他のターミナルで実行中のサーバーを停止してから再試行してください。');
  } else {
    console.error('サーバーエラー:', err.message);
  }
  process.exit(1);
});
