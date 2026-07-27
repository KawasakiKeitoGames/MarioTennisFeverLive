# MTF LIVE — マリオテニスフィーバー 配信中まとめ

今この瞬間に「マリオテニスフィーバー / Mario Tennis Fever」を配信している
YouTube・Twitch チャンネルを横断表示するWebアプリ。視聴者数の推移グラフつき。

- **フレームワーク**: Next.js 14 (App Router) + TypeScript
- **DB**: Supabase (Postgres)
- **ホスティング**: Vercel（Cron Jobs で定期取得）
- **グラフ**: Recharts

## 設計の要点：取得と表示の分離
ユーザーのアクセスでは外部API（YouTube/Twitch）を**一切叩きません**。
Vercel Cron が定期的にデータを取得して Supabase に保存し、
公開ページはその保存済みデータを読むだけ。これで無料枠を守れます。

```
Vercel Cron ──▶ /api/cron/collect ──▶ YouTube/Twitch API ──▶ Supabase(保存)
ブラウザ ──▶ /api/streams, /api/history ──▶ Supabase(読み取りのみ)
```

## セットアップ手順

### 1. Supabase
1. Supabase でプロジェクト作成
2. SQL Editor で `supabase/schema.sql` を実行（テーブル・ビュー・RLSを作成）
3. Settings > API から `URL` / `anon` / `service_role` の3つを控える

### 2. 環境変数
`.env.example` を参考に、Vercel のプロジェクト設定 > Environment Variables に登録：

| 変数 | 用途 | 公開範囲 |
|------|------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL | 公開OK |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 読み取り用キー | 公開OK |
| `SUPABASE_SERVICE_ROLE_KEY` | 書き込み用（Cron） | **サーバー専用・非公開** |
| `YT_API_KEY` | YouTube Data API v3 | **非公開** |
| `TWITCH_CLIENT_ID` | Twitch アプリ | **非公開** |
| `TWITCH_CLIENT_SECRET` | Twitch アプリ | **非公開** |
| `CRON_SECRET` | Cron呼び出し認証 | **非公開** |

### 3. デプロイ
Claude Code から Vercel に push すれば、`vercel.json` の Cron 定義が自動で登録されます。

## Cron スケジュール（`vercel.json`）
Vercel Cron は **UTC** で動きます。日本のゴールデンタイム 20:00〜翌2:00 (JST) は
UTC 11:00〜17:00 に相当します。

- `*/8 11-16 * * *` … ゴールデンタイム相当を8分おき
- `0 17-23,0-10 * * *` … それ以外を毎時

### ⚠️ Vercel の Cron 制限に注意
- **Hobby(無料)プラン**の Cron Jobs は「1日1回まで」かつ「最大2本」など制限が変わることがあります。
  8分おきのような高頻度は Pro プランが必要になる場合があります。
- 高頻度取得を無料で行いたい場合の代替案：
  - **GitHub Actions** の cron（5分間隔〜）から `/api/cron/collect` を叩く（`CRON_SECRET` で認証）
  - **Supabase Edge Functions + pg_cron** で取得処理を動かす
- 最新の制限は Vercel / Supabase のダッシュボードで確認してください。
  希望があれば GitHub Actions 版の定期実行ワークフローも用意します。

## YouTube クォータの目安
- ライブ横断検索は `search`(eventType=live) が1回100ユニット。
- 1回の collect で概ね 120〜200 ユニット。無料枠は 10,000/日。
- 消費を半分にしたい場合は `lib/youtube.ts` の `YT_QUERIES` をキーワード1本に。

## ローカル開発
```bash
npm install
cp .env.example .env.local   # 値を埋める
npm run dev
```

## 収益化・規約について（重要）
広告掲載などの商用利用は、YouTube API Services 利用規約・Twitch Developer Services
Agreement の商用条項に触れる可能性があります。まずは広告なしで公開し、
商用化する際は各規約の確認と必要な申請を行ってください。
