# 変更履歴

## 未リリース

- 書き込める文字を大幅に増やした（文字ツール・PDF内の入力欄・保存したPDFのすべて）
  - 原因：同梱フォントが Noto Sans JP の縮小版（約7,500字形）で、※ ① → ○ □ ～ ★ ♪ ℃ ㈱ や半角カナ、旧字（髙 﨑）、ギリシャ文字などがPDFで空白・□になっていた（画面ではパソコンのフォントで表示されるため気づきにくかった）
  - 対応：Noto Sans JP 完全版を土台に、日本語フォントにない文字だけを Noto Sans（ラテン文字・通貨）・Noto Sans Symbols 2 / Symbols（✔ ✖ ☐ ☑ ☒ など）・Noto Emoji（白黒の絵文字）・Noto Sans KR（ハングル）・Noto Sans SC（簡体字）から取り出して、1つのフォント「File Note Sans」にまとめた（約54,000字形）
  - 1つにまとめたので、日本語と韓国語・絵文字などが混ざった文も、入力欄を含めてそのまま保存できる。行の高さは従来の Noto Sans JP と同じ
  - 絵文字は白黒（PDFにカラー絵文字は入れられないため。画面の表示も保存結果と同じ白黒）
  - それでも表示できない文字（タイ語・アラビア語など）を入力すると、画面下に「次の文字はPDFで表示できません」と表示
  - 保存したPDFの容量：使っている文字の分だけ入れる処理を、文字の幅と文字コードの対応表（/W・/ToUnicode）にも広げた。1行書き込んだPDFは従来の約75KBから約6KBに減少
  - フォントファイルは約2.4MB → 約15.6MB（Web版では初めてPDFを開くときに読み込む。2回目以降はブラウザーに保存される）
  - 「使い方」の窓とREADMEに、書き込める文字を追記
  - 新規：`file-note/fonts/FileNoteSans-Regular.ttf`、`tools/build-font.py`（フォントの作り方）、`tests/characters.spec.mjs`
  - 削除：`file-note/fonts/NotoSansJP-Regular.ttf`
  - 変更：`file-note/font-prune.js`、`editor.js`、`editor.css`、`popup.css`、`editor.html`、`export.js`・`pages.js`（コメント）、`fonts/OFL.txt`、`THIRD_PARTY.md`、`.gitignore`、`tests/editor.spec.mjs`、`README.md`
  - 確認：Playwright 全34テスト合格（新規3件：記号・絵文字・韓国語・中国語などを書き込んで保存しPDFから文字を取り出せる、入力欄に混在した文を保存できる、表示できない文字を知らせる）。画面と保存したPDFの見た目が一致することを画像で確認

- 「ファイルを開く」の左に「使い方」ボタンを追加。押すと編集画面の上に説明の窓を表示
  - 内容：3ステップの使い方、「PDFを保存」と「編集データを保存」の違い、PDFにもとからある入力欄への書き込み方、各ツール、ページの操作、便利な機能、ショートカット、注意点
  - ✕ボタン・Escキー・窓の外のクリックで閉じる。開いている間は Ctrl+S などの編集用ショートカットと貼り付けは動かない
  - PDFを開く前でも押せる。スマホ幅では2つの保存方法の説明を縦に並べる
  - 変更したファイル：`file-note/editor.html`、`editor.css`、`editor.js`、新規 `tests/help.spec.mjs`
  - 確認：Playwright 全31テスト合格（新規3件。入力欄はどのツールを選んでいても入力できることを含む）、パソコン幅・スマホ幅で表示を確認

- Web版（インストール不要）を Cloudflare で公開できるようにした
  - 拡張機能と同じ `file-note/` を使うため、機能は共通。拡張機能版もそのまま使える
  - Web版では「このPDFを編集」（表示中のPDFを開く）とURLからの読み込みは使えない
  - Cloudflare の設定ファイルは「_」で始まり拡張機能に置けないため、`web/` に置いて公開時に組み合わせる
  - Cloudflare の新しい作成画面（Workers）に合わせ、リポジトリ直下の `wrangler.jsonc` で公開フォルダーを指定。トップページは `index.html`（編集画面のコピー）で表示
  - 新規：`web/build.sh`、`web/_headers`、`web/README.md`、`wrangler.jsonc`、`.gitignore`（ルート）
  - 確認：公開用フォルダーをセキュリティ設定付きで配信し、Playwright 28件合格（ポップアップのテスト1件はWeb版に含めないため対象外）、トップページでエラーなし
  - 確認：`wrangler deploy --dry-run` で設定が正しいこと、`wrangler dev` でトップページ・セキュリティ設定・スクリプトが配信され、ポップアップが配信されないこと
  - 公開先：https://file-note.r725cf.workers.dev（README に Web版の案内を追加）

- PDF以外のファイル形式の閲覧機能を削除し、PDF編集専用に変更
  - 開けるのは PDF と編集データ（.filenote）のみ
  - 拡張機能名を「File Note — ChromeのPDFに書き込み」に変更
  - 関連するコード・ライブラリ・テストを削除し、Gitの履歴からも削除
  - 変更したファイル：`file-note/editor.js`、`editor.html`、`editor.css`、`pickers.js`、`popup.html`、`manifest.json`、`THIRD_PARTY.md`、`README.md`（ルートと `file-note/`）、`change.md`

- 編集データ（.filenote）を、PDFなどと同じ方法で開けるようにした
  - 対象：「ファイルを選ぶ」「ファイルを開く」、ドラッグ＆ドロップ、ポップアップの「パソコン内のファイルを選ぶ」
  - 「編集データを開く」ボタンは削除（「ファイルを開く」に一本化）
  - ポップアップから渡す場合のサイズ上限：編集データは350MB（PDFを埋め込むため）、それ以外は従来どおり200MB
  - 変更したファイル：`file-note/editor.js`、`editor.html`、`popup.html`、`pickers.js`、`transfer.js`、`tests/editor.spec.mjs`、`README.md`（ルートと `file-note/`）
- 左上の「File Note」の右に、小さくバージョン（例：v1.7.0）を表示
  - manifest.json の version を読み込んで表示するため、バージョンを上げると自動で変わる
  - 変更したファイル：`file-note/editor.js`、`editor.html`、`editor.css`、`tests/editor.spec.mjs`

- 修正：環境によって「PDFを保存」で保存できない問題（保存先を選んでも何も起きない）
  - 原因：PDF保存だけChromeの保存ダイアログを使っていた。保存先によってはChromeが「キャンセル」と返し、何も表示せずに終わっていた（ダウンロードフォルダを選んだ他のPCで発生）
  - 対応：編集データと同じダウンロード方式に統一。`元の名前_edited.pdf` がChromeのダウンロード先に保存される
  - 保存先を毎回選びたい場合は、Chromeの「ダウンロード前に各ファイルの保存場所を確認する」をオンにする
  - 変更したファイル：`file-note/editor.js`、`file-note/pickers.js`（使わなくなった保存ダイアログの処理を削除）、`tests/editor.spec.mjs`（テスト1件追加）

- PDF保存時に画像だけを圧縮して容量を小さくするオプションを追加（「PDFを保存」の左のチェックボックス「画像を圧縮」。既定はオフ、状態は記憶）
  - 対象：元のPDFに入っている画像と、「写真を追加」で貼った画像
  - JPEG品質0.6で再圧縮。長辺が2000pxを超える画像は2000pxに縮小
  - 圧縮しても小さくならない画像は元のまま残す
  - 文字・図形・フォーム・書き込みは変更しない。編集データ（.filenote）内の画像も変更しない
  - 透過は保持（透過付きの追加写真は縮小のみ）
  - 圧縮しない画像：CMYK、白黒2値、インデックスカラー、JPEG 2000、マスク画像など
- チェックなしの保存結果は従来と同じ
- 改善：文字の書き込み・フォーム入力があるPDFの保存サイズを大幅に削減（フォント1個あたり約1.4MB → 数十KB）
  - 従来は日本語フォント全体を埋め込んでいた。書き込み用とフォーム用で別々に入るため、両方使うと約2.8MB増えていた
  - 埋め込んだフォントから、使っていない文字の形状データだけを取り除く（`font-prune.js`）。文字番号と幅は変えないので表示は同じ
  - pdf-lib のサブセット機能は文字が欠けるため使わない（再検証して確認）
  - 文字ごとの標準の字形も残す。フォーム欄は表示ソフト側が描き直すことがあり（NeedAppearances）、その際は文脈で置き換わる前の字形が使われるため（残さないと、英字に挟まれた数字などが消える）
  - 注意：フォーム欄を他のソフトで後から編集すると、保存時になかった文字が表示されない可能性がある（File Noteで再編集する場合は問題なし）
- 修正：保存したPDFが、MuPDF系のソフト（PyMuPDFなど）で `cannot find object in xref` エラーになることがある問題
  - 原因：元のPDFに欠番（削除済みの部品番号）があると、保存後のPDFの索引からその番号が抜け落ちていた
  - 対応：保存時に欠番を空の部品（null）で埋め、索引を連続させる。見た目・内容は変わらない

### 変更したファイル
- 新規：`file-note/compress.js`、`file-note/font-prune.js`、`tests/compress.spec.mjs`、`docs/superpowers/`（設計書・実装計画）
- 更新：`file-note/export.js`、`pages.js`、`editor.js`、`editor.html`、`editor.css`、`README.md`、`change.md`、`tests/editor.spec.mjs`

### 確認したこと
- Playwright 全32テスト合格（うち新規19件：フォーム欄の字形・フォントの削減・JPEG・Flate・透過・対象外形式・壊れた画像・共有画像・追加写真・チェックボックスの動作と記憶・欠番のあるPDFの保存）
- 欠番のあるPDFを保存した結果を PyMuPDF で読み込み、修正前はエラー・修正後は正常に読めることを確認（圧縮あり／なし／書き込みあり）
- ESLint エラーなし
- フォント削減後の描画を PyMuPDF で全体埋め込み版と比較し、全画素一致・抽出テキスト一致を確認（ひらがな・カタカナ・漢字・英数字・記号、3ページ）
- フォーム入力後のPDFを PDFium（Chromeと同じ描画エンジン）で描画し、英字に挟まれた数字を含む全文字が表示されることを確認
- 未確認：Acrobatでの表示、実際のChromeに拡張機能として読み込んでの動作、実際のスキャンPDFでの圧縮率、学校のソフトそのものでの動作

## v1.7.0

- 名前を「PDF Note」から「File Note」に変更（拡張機能名・画面・ポップアップ・README）
- 親フォルダー名を `PDF_Note_Chrome_Extension` → `File_Note_Chrome_Extension` に変更
- フォルダー名を `pdf-note` → `file-note` に変更（中身はそのまま移動）。**Chromeでは古い拡張機能を削除し、`file-note` フォルダーを読み込み直す必要がある**（拡張機能IDが変わるため、サイトへの読み込み許可と「ファイルのURLへのアクセスを許可する」は再設定）
- 編集データの拡張子を `.pdfnote` → `.filenote` に、内部の識別子を `format: 'file-note'` に変更。**v1.6.0 以前に保存した編集データは開けなくなる**（古い編集データがないことを確認済み）
- 内部名も `file-note-…` に統一（ファイル選択ダイアログの記憶用ID、一時保存用のデータベース名）。ダイアログが前回のフォルダーを覚えている状態は一度リセットされる
- manifest：version 1.7.0（従来は 1.5.0 のままだった）、名前・説明文を更新。権限の追加なし

### 変更したファイル
- 新規：`playwright.chrome.config.js`
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
- Playwright テスト合格：編集データが `.filenote`・`format: 'file-note'` で保存され、再読み込みできること
- テストはインストール済みのChromeで実行（`npx playwright test --config playwright.chrome.config.js`）。Playwright用Chromiumは未ダウンロードのため `npm test` はそのままでは動かない
- ESLint エラーなし
- 未確認：実際のChromeに拡張機能として読み込んでの動作

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
