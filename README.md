# BookShot

スクリーンショットや画像から書籍を解析し、関連図書の提案とSNS投稿文の生成を行うWebアプリです。

## 遊び方
- `ローカル確認`: `GEMINI_API_KEY=AIza... node server.js` を実行し、`http://localhost:3000` を開きます。
- `公開運用`: `bookshot-worker.js` を Cloudflare Workers にデプロイし、`index.html` 内の `REMOTE_PROXY_URL` が Worker のURLになっていることを確認します。
- `利用者操作`: 画像を選ぶ → 解析する → 結果確認 → 投稿文をコピー/共有、の流れです。

## 技術メモ
- フロントは API を直接呼びません。必ず `server.js` または `bookshot-worker.js` を経由します。
- APIキーはブラウザに保存せず、ローカルは `GEMINI_API_KEY` 環境変数、本番は Cloudflare Workers Secret で管理します。
- Cloudflare Workers では `npx wrangler secret put GEMINI_API_KEY` で秘密情報を設定してください。
- Cloudflare Workers デプロイ後、必要なら `ALLOWED_ORIGINS` を公開URLに合わせて調整してください。
- 本番デプロイURL: `https://bookshot-proxy.extralife412.workers.dev`

## 状態
- [x] 開発中
- [x] Gemini API 対応完了（2026-03-29）
- [ ] 完成
- [ ] 要リファクタリング
