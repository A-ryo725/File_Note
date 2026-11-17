# Web版（Cloudflare Pages）

拡張機能と同じ `file-note/` フォルダーを、インストール不要のWebサイトとして公開するための設定です。

## ファイル

| ファイル | 役割 |
|---|---|
| `build.sh` | `file-note/` をコピーして公開用の `dist/` を作る（ポップアップなど拡張機能専用のファイルは除く） |
| `_redirects` | サイトのトップ（`/`）で編集画面を表示する |
| `_headers` | セキュリティ設定（外部のスクリプトを読み込ませない、など） |

`_headers` と `_redirects` は名前が「_」で始まるため、`file-note/` に置くと Chrome が拡張機能を読み込めなくなります。必ずこのフォルダーに置いてください。

## Cloudflare Pages の設定（初回のみ）

1. Cloudflare にログインし、「Workers & Pages」→「作成」→「Pages」→「既存の Git リポジトリをインポート」を選ぶ
2. GitHub と連携し、`A-ryo725/File_Note` を選ぶ
3. ビルド設定を次のとおり入力して「保存してデプロイ」

| 項目 | 値 |
|---|---|
| 本番ブランチ | `main` |
| フレームワーク プリセット | なし |
| ビルド コマンド | `sh web/build.sh` |
| ビルド出力ディレクトリ | `dist` |
| ルートディレクトリ（詳細設定） | `File_Note_Chrome_Extension` |

以降は `main` に push するたびに自動で更新されます。画面の名前は変わることがあります。

## 手元で確認する

```
sh web/build.sh
npx serve dist
```

## Web版でできないこと

- Chromeで表示中のPDFを「このPDFを編集」で開く（拡張機能のボタンが必要）
- Web上のPDFをURLから直接読み込む（ダウンロードしてから「ファイルを開く」で選ぶ）
