# メモ — PWA メモアプリ

オフラインでも使えるメモアプリです。メモの保存先を **この端末だけ（ローカル保存）** と
**アカウントを作ってサーバに保存（複数端末で同期）** から選べます。Vercel にそのままデプロイできます。

## できること

- **PWA** — ホーム画面にインストールでき、オフラインでも起動・編集できます（Service Worker + IndexedDB）
- **ローカル保存** — アカウントなしでもすぐ使えます。メモはブラウザの IndexedDB にのみ保存され、外部に送信されません
- **アカウント保存** — メールアドレスとパスワードで登録すると、メモが Postgres に保存され複数端末で同期します
- **オフライン編集の自動送信** — 圏外で書いた変更は端末に貯まり、オンライン復帰時に自動で送信されます
- **競合解決** — 同じメモを複数端末で編集した場合は更新時刻の新しい方が残ります（last-write-wins）
- **削除の同期** — 削除は tombstone として同期され、他の端末からも消えます
- **ログイン時の取り込み** — ログイン／登録時に、それまで端末に保存していたメモをアカウントへ取り込めます
- 全文検索、自動保存（入力停止から 0.4 秒）、ダークモード対応、スマホ／デスクトップ両対応のレイアウト

1 行目がそのままメモのタイトルになります。

## 動かす

```bash
npm install
npm run dev          # http://localhost:3000
```

環境変数なしでも動きます。その場合はローカル保存モードのみになり、
ログインボタンからの登録は「サーバ保存は未設定です」と表示されます。

### アカウント機能（サーバ保存）を有効にする

`.env.local` を作って次の 2 つを設定します（`.env.example` を参照）。

| 変数 | 用途 |
| --- | --- |
| `POSTGRES_URL` | Postgres 接続文字列。`DATABASE_URL` でも可 |
| `AUTH_SECRET`  | セッション Cookie の署名鍵（32 バイト以上推奨） |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # AUTH_SECRET の生成
```

テーブル（`users` / `memos`）は初回アクセス時に自動作成されるので、マイグレーション操作は不要です。

## Vercel へのデプロイ

1. このリポジトリを GitHub に push し、Vercel で **Import Project**（フレームワークは Next.js が自動検出されます）
2. データベースを用意する
   - Vercel の **Storage → Create Database → Postgres**（Neon）を作成してプロジェクトに接続すると
     `POSTGRES_URL` が自動で環境変数に入ります
   - Supabase など外部の Postgres でも構いません。その場合は `POSTGRES_URL` を手動で登録します
     （`?sslmode=require` を付けてください）
3. **Settings → Environment Variables** で `AUTH_SECRET` を追加する
4. Deploy

アカウント機能を使わず、ローカル保存だけで公開する場合は環境変数の設定は不要です。

補足:

- サーバレス環境では接続数が増えやすいため、プール付きの接続文字列（Neon の `-pooler` ホストなど）を推奨します
- PWA のインストールと Service Worker は HTTPS が必要です。Vercel のドメインはそのまま条件を満たします
  （ローカルでは `localhost` が例外として許可されます）

## 仕組み

```
ブラウザ                                     サーバ (Next.js Route Handlers)
┌────────────────────────────┐               ┌───────────────────────────────┐
│ React UI                   │               │ /api/auth/signup | login       │
│   ↕                        │               │ /api/auth/logout | me          │
│ IndexedDB (pwa-memo)       │──POST /sync──▶│ /api/memos/sync                │
│   local|…   端末だけのメモ   │◀──変更差分───│   last-write-wins で upsert    │
│   u:<id>|…  アカウントの控え │               │ /api/memos/purge (tombstone GC)│
└────────────────────────────┘               └───────────────┬───────────────┘
        ▲ Service Worker (/sw.js)                            │
        └ アプリシェルをキャッシュ                      Postgres (users, memos)
```

- 書き込みは常にまず IndexedDB に入り、`dirty` フラグが付きます。アカウントモードではその後
  `/api/memos/sync` に送られ、成功したものだけフラグが外れます。だからオフラインでも書けます。
- 同期カーソル（最後に取り込んだ `updatedAt`）を端末ごとに保持し、差分だけをやり取りします。
- パスワードは scrypt でハッシュ化し、セッションは HMAC-SHA256 で署名した httpOnly Cookie で保持します。

### ディレクトリ

```
src/app/            ページと API ルート
src/components/     UI コンポーネント
src/lib/db.ts       Postgres 接続とスキーマ作成
src/lib/auth.ts     パスワードハッシュとセッション Cookie
src/lib/localdb.ts  IndexedDB（ローカル保存とオフラインキャッシュ）
src/lib/store.ts    同期エンジンと API クライアント
public/sw.js        Service Worker
scripts/generate-icons.mjs  アイコン PNG を生成（build 時に自動実行）
```

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバ |
| `npm run build` | アイコン生成 → 本番ビルド |
| `npm start` | 本番サーバ |
| `npm run lint` | ESLint |
| `npm run typecheck` | 型チェック |
| `npm run icons` | PWA アイコンの生成のみ |

## プライバシー

ローカル保存モードのメモは端末のブラウザから出ません。アカウントモードでは、メモの本文が
自分で用意した Postgres に保存されます。ログアウト時に、この端末へ残っているアカウントの
メモの控えを消すかどうかを選べます。
