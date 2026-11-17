#!/bin/sh
# Cloudflare 用：拡張機能と同じ file-note/ から Web 版の公開フォルダー dist/ を作る。
# Cloudflare の設定ファイル（_headers）は名前が「_」で始まり、
# file-note/ に置くと Chrome が拡張機能を読み込めなくなるため、ここで dist/ に加える。
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir dist
cp -R file-note/. dist/
# 拡張機能のポップアップと開発用の説明は Web 版では使わない
rm -f dist/popup.html dist/popup.js dist/popup.css dist/README.md dist/VALIDATION.md
# サイトのトップ（/）で編集画面を表示する
cp dist/editor.html dist/index.html
cp web/_headers dist/
echo "dist/ を作成しました"
