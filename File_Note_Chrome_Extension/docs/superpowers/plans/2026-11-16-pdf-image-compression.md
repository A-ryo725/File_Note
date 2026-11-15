# PDF保存時の画像圧縮オプション Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「PDFを保存」時に、元PDF内の画像と追加した写真だけを再圧縮して容量を減らすかどうかを、チェックボックスで選べるようにする。

**Architecture:** 新規 `file-note/compress.js` に画像の再圧縮処理をまとめる。`buildPdf` が `compress` フラグを受け取り、有効時だけ (1) `assemblePdf` 直後に元PDFの画像XObjectを差し替え、(2) 追加写真を埋め込む前に再圧縮する。UIはヘッダーのチェックボックス1つ。

**Tech Stack:** ブラウザ拡張(ES Modules)、同梱の pdf-lib(`globalThis.PDFLib`)、Canvas / `createImageBitmap`、Playwright テスト。追加ライブラリなし。

**Spec:** `docs/superpowers/specs/2026-11-16-pdf-image-compression-design.md`

## Global Constraints

- JPEG品質は `0.6`、長辺上限は `2000` px(超える場合のみ縮小)。
- 再圧縮後のバイト数が元より小さい場合だけ差し替える。
- チェックなしの保存結果は従来と完全に同じ(圧縮コードを一切通さない)。
- 1枚の画像で例外が出ても、その画像を元のまま残して保存を続ける。
- UI文言は「画像を圧縮」のみ。説明文やセカンダリラベルを足さない。
- 追加点を `change.md` に記載する。
- git の add / commit / push はしない(CLAUDE.md)。コミット手順は計画に含めない。
- コマンド実行前に目的を一言説明する(CLAUDE.md)。
- テスト実行:`File_Note_Chrome_Extension` で `npm test`。整形:`npm run format`、`npm run lint`。

## Review Focus

- 壊れたJPEGストリーム(復号に失敗)→ その画像は元のまま、保存は成功する。
- `/Filter` が1要素の配列(`[/DCTDecode]`)→ 単体フィルタとして扱い圧縮する。2要素以上は触らない。
- グレースケール画像 → canvas はRGBのJPEGを出すので、差し替え時は必ず `/ColorSpace /DeviceRGB` にする。大きくなれば差し替えない。
- 複数ページで共有されている同一画像 → 1回だけ圧縮され、全ページで表示される。
- `localStorage` が使えない環境 → 例外にせず、チェックなし扱いで動く。

---

### Task 1: compress.js(元PDF内の画像の再圧縮)

**Files:**
- Create: `file-note/compress.js`
- Modify: `file-note/export.js`(`buildPdf` に `compress` 引数)
- Test: `tests/compress.spec.mjs`(新規)

**Interfaces:**
- Produces:
  - `export const JPEG_QUALITY = 0.6; export const MAX_SIDE = 2000;`
  - `export async function compressImages(doc: PDFDocument): Promise<void>` — `doc.context` 内の画像XObjectをその場で差し替える。
  - `buildPdf({ ..., compress = false })` — `true` のとき `assemblePdf` の直後に `await compressImages(output)` を呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`tests/compress.spec.mjs`。`editor.spec.mjs` の `openPdf` と同じ方式(ピッカーを削除し `#fileInput` に投入、保存は `page.waitForEvent('download')`)。テストからは `page.evaluate` で `buildPdf` を直接呼ばず、UIが未実装のこのタスクでは次のヘルパーで呼ぶ:

```js
// ページ内で export.js を import して buildPdf を実行し、出力バイト列を返す。
async function build(page, pdfBytes, compress) {
  await page.goto('/editor.html');
  const out = await page.evaluate(async ({ b64, compress }) => {
    const { buildPdf } = await import('./export.js');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await PDFLib.PDFDocument.load(bytes);
    const pages = doc.getPages().map((_, i) => ({ source: 0, page: i }));
    const result = await buildPdf({ sources: [{ bytes }], pages, annotations: pages.map(() => []), dimensions: [], fontBytes: null, compress });
    let s = '';
    for (let i = 0; i < result.length; i += 32768) s += String.fromCharCode(...result.subarray(i, i + 32768));
    return btoa(s);
  }, { b64: pdfBytes.toString('base64'), compress });
  return Buffer.from(out, 'base64');
}
// 出力PDF内の画像XObjectの辞書情報を列挙する。
async function images(bytes) { /* PDFLib で load し、enumerateIndirectObjects から Subtype=Image の
  { width, height, filter, colorSpace, hasSMask, length } を返す */ }
```

ノイズ画像(圧縮しても大きい)は `page.evaluate` の canvas で乱数ピクセルを描いて作る。

テストケースと検証値:

| テスト名 | 入力 | 検証 |
|---|---|---|
| `JPEG画像を縮小・再圧縮する` | 3000×2000 ノイズJPEG(品質0.95)を `embedJpg` し、同じページに `drawText('Hello')` | 出力サイズ < 入力の50%。画像は `width===2000, height===1333, filter==='/DCTDecode'`。ページ数同じ。ページのコンテンツストリームのバイト列が入力と一致 |
| `Flate画像をJPEGにする` | 1200×800 不透明ノイズPNGを `embedPng` | `filter==='/DCTDecode'`, `colorSpace==='/DeviceRGB'`, `width===1200`、出力サイズ < 入力 |
| `透過画像はSMaskを保つ` | 半透明の 800×600 ノイズPNGを `embedPng` | 本体は `/DCTDecode`、`hasSMask===true`、SMask側ストリームのバイト列が入力と一致 |
| `対象外の画像は触らない` | `context.stream` で手作りした `BitsPerComponent 1` / `DeviceGray` の画像XObjectをページの XObject に登録 | そのストリームのバイト列と辞書が入力と一致、保存成功 |
| `壊れたJPEGは元のまま残す` | `/Filter /DCTDecode` だが中身が乱数の画像XObject | バイト列が入力と一致、保存成功 |
| `Filterが1要素配列でも圧縮する` | 1件目のJPEG画像の `/Filter` を `[/DCTDecode]` に書き換えたPDF | `width===2000` |
| `共有画像は全ページで残る` | 同じ `embedJpg` 画像を2ページに `drawImage` | 画像XObjectは1個、両ページの XObject が同じ参照を指す |
| `compress=false は何も変えない` | 1件目と同じPDF | 画像ストリームのバイト列が入力と一致 |

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- compress.spec.mjs`
Expected: FAIL(`compress` が無視され、画像が 3000×2000 のまま)

- [ ] **Step 3: `file-note/compress.js` に `compressImages(doc)` を実装**

方針(シグネチャとテストで決まらない部分だけ):

- 走査:`doc.context.enumerateIndirectObjects()` のうち `PDFRawStream` かつ `dict` の `/Subtype` が `/Image` のもの。
- 対象条件(すべて満たす):
  - `/BitsPerComponent` が 8
  - `/ImageMask` が true でない、`/Mask` なし、`/Decode` なし
  - `/ColorSpace` が `/DeviceRGB`・`/DeviceGray`、または `[/ICCBased ref]` で参照先ストリームの `/N` が 1 か 3
  - `/Filter` が `/DCTDecode` か `/FlateDecode` の単体(名前、または1要素の配列)。`/FlateDecode` は `/DecodeParms` の `/Predictor` が無いか 1 のときだけ
- 復号:
  - DCT:`createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }))`
  - Flate:`PDFLib.decodePDFRawStream(stream).decode()` を 成分数(1 or 3)× Width × Height として `ImageData`(RGBA、α=255)に展開。長さが合わなければスキップ
- 再符号化:長辺が `MAX_SIDE` を超えるときだけ等比縮小(`Math.round`、最小1)し、`OffscreenCanvas` → `convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })`。
- 差し替え:新バイト数 < `stream.contents.length` のときだけ、`context.assign(ref, context.stream(bytes, dict))` 相当で置換。辞書は元のキーを引き継いだうえで `/Width` `/Height` `/ColorSpace /DeviceRGB` `/BitsPerComponent 8` `/Filter /DCTDecode` を設定し、`/DecodeParms` を削除。`/SMask` などその他のキーは残す。
- 画像1枚ごとに `try/catch`。失敗時は `console.warn` して次へ。

- [ ] **Step 4: `export.js` の `buildPdf` に `compress = false` を追加**

`assemblePdf` の直後に `if (compress) await compressImages(output);`。

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test -- compress.spec.mjs`
Expected: 8件 PASS

---

### Task 2: 追加した写真の再圧縮

**Files:**
- Modify: `file-note/compress.js`, `file-note/export.js:36`
- Test: `tests/compress.spec.mjs`

**Interfaces:**
- Consumes: `JPEG_QUALITY`, `MAX_SIDE`
- Produces: `export async function recompressDataUrl(dataUrl: string): Promise<string>` — 再圧縮した data URL。小さくならなければ引数をそのまま返す。

- [ ] **Step 1: 失敗するテストを書く**

Task 1 の `build` ヘルパーに `annotations` を渡せるよう引数を足す(1ページ目に `{ type: 'image', x: 0, y: 0, w: 200, h: 133, data }`、`dimensions[0] = { width: 400, height: 600 }`)。

| テスト名 | data | 検証 |
|---|---|---|
| `追加写真を再圧縮する` | 2400×1600 ノイズJPEG(品質0.9) | 埋め込み画像が `width===2000, height===1333`。`compress=false` の出力より小さい |
| `透過PNGは透過を保ち縮小だけする` | 2400×1600 半透明ノイズPNG | 画像は `hasSMask===true`、`width===2000` |
| `小さい透過PNGはそのまま` | 300×200 半透明PNG | `compress=false` の出力と画像ストリームのバイト列が一致 |

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- compress.spec.mjs`
Expected: 新規3件のうち上2件が FAIL(`width` が 2400)

- [ ] **Step 3: `recompressDataUrl` を実装し、`export.js` で使う**

- 復号は `fetch(dataUrl)` → `createImageBitmap`。canvas に描いたあと α<255 の画素があれば透過あり。
- 透過あり:長辺 > `MAX_SIDE` のときだけ縮小してPNGで返す。それ以外は引数をそのまま返す。
- 透過なし:(必要なら縮小して)JPEG `JPEG_QUALITY`。
- 結果の文字列長が引数以上なら引数を返す。例外時も引数を返す。
- `export.js:36`:`const data = compress ? await recompressDataUrl(o.data) : o.data;` を使って `embedPng` / `embedJpg` を判定。`o.data` 自体は書き換えない(編集データを変えない)。
- この画像は `layer` 文書に埋め込まれるため、Task 1 の `compressImages(output)` は通らない。二重圧縮にならないことをコメント1行で残す。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- compress.spec.mjs`
Expected: 11件 PASS

---

### Task 3: チェックボックスUIと保存処理への接続

**Files:**
- Modify: `file-note/editor.html:14`, `file-note/editor.css`, `file-note/editor.js`(`setBusy` の id 一覧 110行付近、保存処理 1544行付近)
- Modify: `change.md`, `file-note/README.md`(保存の説明がある箇所に1行)
- Test: `tests/compress.spec.mjs`

**Interfaces:**
- Consumes: `buildPdf({ compress })`
- Produces: `<label class="check" id="compressRow"><input type="checkbox" id="compress" disabled />画像を圧縮</label>` を `#save` ボタンの直前に置く。記憶キーは `localStorage['file-note-compress']`(値 `'1'` / 削除)。

- [ ] **Step 1: 失敗するテストを書く**

`editor.spec.mjs` と同じ `openPdf` 方式で、実際のUIから保存する。

| テスト名 | 手順 | 検証 |
|---|---|---|
| `チェックありで保存すると小さくなる` | 3000×2000 ノイズJPEG入りPDFを開く → `#compress` をチェック → `#save` クリック → download を読む | ダウンロードのサイズ < 入力の50%、`#status` が「編集済みPDFをダウンロードしました」で始まる |
| `チェックなしは従来どおり` | 同じPDFをチェックなしで保存 | 画像が `width===3000` のまま |
| `チェック状態を記憶する` | チェック → `page.reload()` | `#compress` がチェック済み |
| `PDFを開く前は無効` | `/editor.html` を開いただけ | `#compress` が disabled |
| `localStorageが使えなくても動く` | `addInitScript` で `Storage.prototype.getItem/setItem` を throw に差し替え → 開いてチェックして保存 | pageerror なし、ダウンロード成功 |

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- compress.spec.mjs`
Expected: 新規5件 FAIL(`#compress` が存在しない)

- [ ] **Step 3: 実装**

- `editor.html`:上記の `label` を `#save` の直前に追加。
- `editor.css`:`.actions` 内で他のボタンと縦位置が揃い、狭い幅(295行付近のメディアクエリ)では 12px になるようにする。既存の `.check` スタイルと衝突しないこと。
- `editor.js`:
  - `setBusy` の id 一覧に `'compress'` を追加(`busy || !pdf` で無効)。
  - 起動時に `localStorage` から復元、`change` で保存。どちらも `try/catch` で囲む。
  - 保存処理の `buildPdf({ ... })` に `compress: $('compress').checked` を渡す。
- `change.md`:追加点を既存の書式で追記。

- [ ] **Step 4: 全テスト・整形・lint**

Run: `npm test`
Expected: 既存テストを含め全件 PASS

Run: `npm run format` → `npm run lint`
Expected: エラーなし

- [ ] **Step 5: 実機確認**

拡張のエディタを開き、写真入りの実PDFをチェックあり/なしで保存。サイズ差と、文字が選択できること・画像が崩れていないことを目視で確認する。
