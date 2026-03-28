/**
 * BookShot — ローカルプロキシサーバー
 * Node.js 標準ライブラリのみ使用（npm install 不要）
 *
 * 起動方法: ANTHROPIC_API_KEY=... node server.js
 * ブラウザで開く: http://localhost:3000
 *
 * 役割:
 *   ブラウザ → localhost:3000/api/analyze → api.anthropic.com
 *   ※ ブラウザからは同一オリジン通信なので CORS なし
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT   = 3000;
const DIR    = __dirname;   // server.js と同じフォルダ
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/* ═══════════════════════════════════════════════════════
   ルーター
═══════════════════════════════════════════════════════ */
const server = http.createServer((req, res) => {

  // ── 全レスポンスに CORS ヘッダーを付与（ローカル確認用）
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
        ? 'BookShot local proxy is ready.'
        : 'ANTHROPIC_API_KEY が未設定です。'
    });
    return;
  }

  // ── POST /api/analyze → Anthropic API へプロキシ
  if (req.method === 'POST' && req.url === '/api/analyze') {
    if (!API_KEY) {
      sendJson(res, 503, { error: { message: 'ANTHROPIC_API_KEY が未設定です' } });
      return;
    }

    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(rawBody); }
      catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'リクエストのJSONが不正です: ' + e.message } }));
        return;
      }

      const { imageBase64, mediaType, prompt } = parsed;

      if (!imageBase64) {
        sendJson(res, 400, { error: { message: 'imageBase64 が指定されていません' } });
        return;
      }

      // Anthropic へのリクエストボディ
      const anthropicBody = JSON.stringify({
        model:      'claude-opus-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'image',
              source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 }
            },
            { type: 'text', text: prompt }
          ]
        }]
      });

      const options = {
        hostname: 'api.anthropic.com',
        port:     443,
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(anthropicBody),
          'x-api-key':         API_KEY,
          'anthropic-version': '2023-06-01'
        }
      };

      console.log(`[${new Date().toLocaleTimeString()}] Anthropic API へリクエスト送信...`);

      const apiReq = https.request(options, (apiRes) => {
        let responseBody = '';
        apiRes.on('data', chunk => { responseBody += chunk; });
        apiRes.on('end', () => {
          console.log(`[${new Date().toLocaleTimeString()}] レスポンス受信: HTTP ${apiRes.statusCode}`);
          res.writeHead(apiRes.statusCode || 500, { 'Content-Type': 'application/json' });
          res.end(responseBody);
        });
      });

      apiReq.on('error', (e) => {
        console.error('Anthropic API 通信エラー:', e.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Anthropic APIへの接続に失敗: ' + e.message } }));
      });

      apiReq.write(anthropicBody);
      apiReq.end();
    });
    return;
  }

  // ── POST /api/test → APIキー疎通確認（テキストのみ、画像なし）
  if (req.method === 'POST' && req.url === '/api/test') {
    if (!API_KEY) {
      sendJson(res, 503, { error: { message: 'ANTHROPIC_API_KEY が未設定です' } });
      return;
    }

    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', () => {
      try { JSON.parse(rawBody || '{}'); } catch (e) {}

      const testBody = JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }]
      });

      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(testBody),
          'x-api-key':         API_KEY,
          'anthropic-version': '2023-06-01'
        }
      };

      const apiReq = https.request(options, (apiRes) => {
        let body = '';
        apiRes.on('data', c => { body += c; });
        apiRes.on('end', () => {
          res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(body);
        });
      });
      apiReq.on('error', (e) => {
        sendJson(res, 502, { error: { message: e.message } });
      });
      apiReq.write(testBody);
      apiReq.end();
    });
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
    console.log('※ ANTHROPIC_API_KEY が未設定です。');
    console.log('  例: ANTHROPIC_API_KEY=sk-ant-... node server.js');
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
