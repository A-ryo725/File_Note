# 変更履歴

## v1.7.0

- 名前を「PDF Note」から「File Note」に変更（拡張機能名・画面・ポップアップ・README）
- Word（.docx）・PowerPoint（.pptx）の閲覧に対応（編集・保存は不可）
  - 開き方：「ファイルを開く」、ドラッグ＆ドロップ、ポップアップの「パソコン内のファイルを選ぶ」
  - 閲覧中は編集ツール・表示形式の切り替えを隠し、「PDFを保存」「編集データを保存」は無効
  - ページ送り・拡大縮小・「幅に合わせる」はPDFと同じボタンを共用
  - PowerPoint：左にスライド一覧（選択中はオレンジ枠）。矢印キー・PageUp / PageDown・Space・Home / Endで移動
  - Word：サイドバーなし。スクロール位置に合わせてページ番号を表示
- 未保存の編集があるPDFを開いたままWord・PowerPointを開くときは、確認を表示
- 開けないファイル（旧形式 .doc / .ppt、破損、パスワード付き）はステータス欄にエラーを表示し、表示中の文書はそのまま残す
- 一部のツールで作られたPowerPoint（存在しない部品への参照を含むもの）も開けるよう、読み込み前に修復
- 描画ライブラリは、Word・PowerPointを初めて開いたときにだけ読み込む（PDFだけ使う場合の起動は変わらない）
- 親フォルダー名を `PDF_Note_Chrome_Extension` → `File_Note_Chrome_Extension` に変更
- フォルダー名を `pdf-note` → `file-note` に変更（中身はそのまま移動）。**Chromeでは古い拡張機能を削除し、`file-note` フォルダーを読み込み直す必要がある**（拡張機能IDが変わるため、サイトへの読み込み許可と「ファイルのURLへのアクセスを許可する」は再設定）
- 編集データの拡張子を `.pdfnote` → `.filenote` に、内部の識別子を `format: 'file-note'` に変更。**v1.6.0 以前に保存した編集データは開けなくなる**（古い編集データがないことを確認済み）
- 内部名も `file-note-…` に統一（ファイル選択ダイアログの記憶用ID、一時保存用のデータベース名）。ダイアログが前回のフォルダーを覚えている状態は一度リセットされる
- manifest：version 1.7.0（従来は 1.5.0 のままだった）、名前・説明文を更新。権限の追加なし

### 変更したファイル
- 新規：`file-note/office.js`、`file-note/office-repair.js`、`file-note/vendor/docx-preview.min.js`、`pptx-preview.umd.js`、`jszip.min.js`、`DOCX-PREVIEW-LICENSE`、`JSZIP-LICENSE.md`、`tests/office.spec.mjs`、`tests/fixtures/`（確認用ファイル4件）、`playwright.chrome.config.js`
- 更新：`file-note/editor.js`、`editor.html`、`editor.css`、`pickers.js`、`popup.html`、`popup.js`、`transfer.js`、`manifest.json`、`README.md`、`THIRD_PARTY.md`、`change.md`
- 名前の変更に伴う更新：`package.json`、`package-lock.json`、`eslint.config.js`、`.prettierignore`、`.gitignore`（`*.filenote` を追加）、`tests/server.mjs`、`tests/*.spec.mjs`
- 移動：`pdf-note/` フォルダー全体 → `file-note/`、`PDF_Note_Chrome_Extension/` → `File_Note_Chrome_Extension/`
- 名前の統一に伴う更新：`file-note/VALIDATION.md`（表記のみ）
- 削除：なし

### 変更しなかったこと
- リポジトリのルートフォルダー `C:\PDF_Extension` と GitHub のリポジトリ名（`PDF_Extension`）
- PDFの編集・保存の処理
- 初期画面の見出し「PDFに、書き込もう。」

### 確認したこと
- Playwright 13テスト合格（既存7件＋新規6件）：編集データが `.filenote`・`format: 'file-note'` で保存され、再読み込みできること、Word・PowerPointの表示、編集ツールの非表示、ページ送り・キー操作・拡大縮小、PDFとの切り替え、エラー表示、未保存時の確認、ドラッグ＆ドロップ
- テストはインストール済みのChromeで実行（`npx playwright test --config playwright.chrome.config.js`）。Playwright用Chromiumは未ダウンロードのため `npm test` はそのままでは動かない
- ESLint エラーなし
- 未確認：実際のChromeに拡張機能として読み込んでの動作、ポップアップ経由でのWord・PowerPointの受け渡し、実際にOfficeで作成したファイル（確認は生成したサンプルのみ）

### 注意
- pptx-preview は配布パッケージの利用は無償（商用可）だが、ソース非公開・改変不可。一般公開する場合は作者の条件を確認すること（`file-note/THIRD_PARTY.md`）

## v1.6.0

- 四角・楕円：色設定の下に「塗りつぶし」チェックを追加（画面・サムネイル・保存PDFに反映。選択中の図形にも適用）
- 写真を追加：ピッカーが「ピクチャ」フォルダで開き、2回目以降は前回のフォルダで開く
- PDFを保存：保存先ダイアログが開き、「PDFを開く」で選んだPDFのフォルダで開く
- 四角・楕円：ドラッグ中にShiftキーで正方形・正円（ページ内に収まるよう制限）
- マーカー：ドラッグ中にShiftキーで水平・垂直
- 修正：写真ピッカーをキャンセルすると、別のファイル選択が続けて開く不具合（キャンセルを「非対応」と誤判定していた）
- 白塗り機能を削除（白塗りを含む古い `.pdfnote` は開けなくなる）
- 変更したファイル：`pdf-note/pickers.js`（新規）、`editor.js`、`editor.html`、`editor.css`、`export.js`、`sidebar.js`、`helpers.js`、`README.md`、`tests/*.mjs`、`change.md`
- 制限：元PDFのフォルダを開けるのは「PDFを開く」で選んだ場合のみ。ポップアップ経由・Chromeのタブから開いた場合・ドラッグ＆ドロップは、前回の保存先で開く。非対応環境では従来のダウンロードに戻る
- 確認：Playwright 6テスト合格、ESLint エラーなし

## v1.5.4

- 補足ラベル・説明文を削除し、レイアウトだけで伝わるUIにした
  - エディタ：ツール説明、プライバシー注記、フッター注記、サイドバー見出し／ヒント、空画面の説明文、文字入力ダイアログの注記を削除
  - 選択中の表示は「2個選択中」「四角」のように短く、選択時のみ表示
  - ポップアップ：説明文・注記を削除（エラー時のみメッセージ表示）
- ツールのヒントは削除せず、1行の簡潔な文に短縮して復活（例：「ドラッグ中にShiftキーで水平・垂直。Shift+ドラッグで書き込みを範囲選択」）
- 変更したファイル：`editor.html`、`editor.js`、`popup.html`、`popup.css`、`tests/selection.spec.mjs`、`change.md`

## v1.5.3

- 描画ツールでShift+ドラッグして選択しても、「選択・移動」に切り替わらず、今のツールのままにした（選択後は矢印キーで移動、Deleteで削除、Ctrl+Cでコピー）
- 変更したファイル：`editor.js`、`tests/selection.spec.mjs`
- 確認：Playwright 6テスト合格、ESLint エラーなし

## v1.5.2

- 手書き：クリックするだけで、ペンの太さの●（点）を打てる。画面・サムネイル・保存PDFのすべてに反映（保存PDFでは塗りつぶしの円で出力）
- サムネイル追従：サムネイルの高さが実寸に更新されて現在のカードが画面外にずれる問題を修正（テストが間欠的に失敗して発覚）
- `.gitignore` を新規作成（node_modules、テスト出力、.env・鍵、`*.pdf`、`*.pdfnote` など）
- 変更したファイル：`editor.js`、`export.js`、`sidebar.js`、`tests/selection.spec.mjs`、`.gitignore`（新規）
- 確認：Playwright 6テスト合格（点のテストは、保存PDFを描画して20ptの点が約314ピクセルになることを確認）、追従テストは4回連続で合格、ESLint エラーなし

## v1.5.1

### 追加・変更
- 連続表示：スクロールして表示中のページが変わると、左のサムネイル一覧も自動でそのページまでスクロールする
- 範囲選択：「選択・移動」で何もない所からドラッグすると、触れた書き込みをまとめて選択
- Shift+ドラッグで範囲選択：直線・手書き・マーカー・四角・楕円・矢印・白塗りの各ツールで有効（選択後は「選択・移動」に切り替わる）
- Shift+クリックで選択に追加／解除
- 複数選択した書き込みを、まとめて移動・削除・コピー＆貼り付け・矢印キー移動できる
- ツールのヒント文を更新
- 注意：直線・矢印で「ドラッグ開始前にShiftを押しておく」と範囲選択になる。水平・垂直にしたい場合は、ドラッグを始めてからShiftを押す

### 変更したファイル
- `pdf-note/editor.js`、`pdf-note/sidebar.js`、`tests/selection.spec.mjs`（新規）、`change.md`

### 確認したこと
- Playwright 5テスト合格（新規2：範囲選択・Shift+ドラッグ・グループ移動と削除／連続表示でのサムネイル追従）、ESLint エラーなし
- 未確認：実際のChromeに拡張機能として読み込んでの動作

## v1.5.0

### 追加
- 図形ツール：四角・楕円・矢印（色・太さは直線と共通）
- 白塗りツール（※見た目を隠すだけ。元の文字データはPDFに残るため、機密情報の削除には使えません）
- ページの右回転、白紙ページの挿入（サイドバー上部のボタン）
- フォーム：チェックボックス・ラジオボタン・プルダウン（単一選択）に対応
- 選択した書き込みを矢印キーで移動（Shiftで10pt。押し続けても「戻す」は1回分）
- 書き込みのコピー＆貼り付け（Ctrl+C / Ctrl+V）
- ドラッグ＆ドロップ：複数PDFは連結して開く／画像は写真として追加
- 開発用：Playwright テスト（`npm test`）、Prettier（`npm run format`）、ESLint（`npm run lint`）

### 改善
- 写真：JPEGはJPEGのまま保存。透過なしのPNGは、JPEGの方が半分以下の大きさになる場合だけJPEGに変換
- 手書き線：PDFでも角を丸くして画面と一致させた。点を間引いて（0.15pt）ファイルを軽量化
- 「戻す」履歴：画像データを履歴間で共有し、メモリ使用量を削減
- 描画：ドラッグ中は操作中のページだけ再描画。文字幅計測の canvas を使い回し
- 読み込めないフォーム欄があっても、PDF全体の読み込み・保存が失敗しないようにした
- コード全体を Prettier で整形

### 変更したファイル
- 新規：`pdf-note/helpers.js`、`package.json`、`playwright.config.js`、`eslint.config.js`、`.prettierrc.json`、`.prettierignore`、`tests/editor.spec.mjs`、`tests/server.mjs`、`change.md`
- 更新：`pdf-note/editor.js`、`export.js`、`pages.js`、`sidebar.js`、`editor.html`、`editor.css`、`popup.js`（空のcatchにコメント追加のみ）、`manifest.json`（version 1.5.0）、`README.md`
- Prettier により `pdf-note/*.js|css|html` の書式が全体的に変わっています

### 対応しなかったこと
- **フォントのサブセット化**：試したところ、pdf-lib の不具合でフォーム欄の文字が欠けた（「山田太郎」→「山田」）ため、従来どおり全体埋め込みに戻した。保存PDFは約1.4MB増える
- **文字の太字・背景色**：同梱フォントが Regular のみのため。太字には別フォント（数MB）の追加が必要
- **複数選択のリストボックス・編集可能なコンボボックス**：未対応（従来どおり表示のみ）
- **書き込みのあるページの回転**：座標がずれるため不可（先に回転してから書き込む）

### 確認したこと
- Playwright 3テスト合格：書き込み・フォーム4種・各図形・写真(JPEG)・矢印キー移動・コピペ・回転・白紙挿入・PDF保存（ページ数、フォーム値、日本語文字の描画、回転）・編集データ保存と再読込・手書きの点の間引き・D&D（複数PDF連結／画像）
- ESLint エラーなし
- 未確認：実際のChromeに拡張機能として読み込んでの動作（テストは同じ editor.html を通常のChromiumで開いて実施）。ポップアップ（popup.js）経由の起動は未テスト
