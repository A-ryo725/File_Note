# Web版（Cloudflare）

拡張機能と同じ `file-note/` フォルダーを、インストール不要のWebサイトとして公開するための設定です。

## ファイル

| ファイル | 役割 |
|---|---|
| `build.sh` | `file-note/` をコピーして公開用の `dist/` を作る（ポップアップなど拡張機能専用のファイルは除き、トップページ用に `index.html` を加える） |
| リポジトリ直下の `wrangler.jsonc` | Cloudflare に公開するフォルダー（`dist/`）を伝える |
| `_headers` | セキュリティ設定（外部のスクリプトを読み込ませない、など） |

`_headers` は名前が「_」で始まるため、`file-note/` に置くと Chrome が拡張機能を読み込めなくなります。必ずこのフォルダーに置いてください。

## Cloudflare の設定（初回のみ）

1. Cloudflare にログインし、「Workers & Pages」→「作成」→「リポジトリをインポート」（Import a repository）を選ぶ
2. GitHub と連携し、`A-ryo725/File_Note` を選ぶ
3. 次のとおり入力して「デプロイ」

| 項目 | 値 |
|---|---|
| プロジェクト名 | `file-note`（`wrangler.jsonc` の `name` と同じにする） |
| ビルド コマンド | `sh File_Note_Chrome_Extension/web/build.sh` |
| デプロイ コマンド | `npx wrangler deploy`（最初から入っていればそのまま） |
| パス（詳細設定） | 空欄（`/`）のまま |

以降は `main` に push するたびに自動で更新されます。画面の名前は変わることがあります。

## 手元で確認する

```
sh File_Note_Chrome_Extension/web/build.sh
npx wrangler dev
```

## Web版でできないこと

- Chromeで表示中のPDFを「このPDFを編集」で開く（拡張機能のボタンが必要）
- Web上のPDFをURLから直接読み込む（ダウンロードしてから「ファイルを開く」で選ぶ）
