# Third-party components

Runtime dependencies are bundled locally; the extension executes no remotely hosted code.

| Component | Version | Source | License |
|---|---|---|---|
| PDF.js / pdfjs-dist | 5.6.205 | https://github.com/mozilla/pdf.js | Apache-2.0 (`vendor/PDFJS-LICENSE`) |
| pdf-lib | 1.17.1 | https://github.com/Hopding/pdf-lib | MIT (`vendor/PDFLIB-LICENSE.md`) |
| @pdf-lib/fontkit | 1.1.1 | https://github.com/Hopding/fontkit | MIT (`vendor/FONTKIT-LICENSE`) |
| File Note Sans（`fonts/FileNoteSans-Regular.ttf`） | Noto Sans JP 2.004 を土台に、Noto Sans 2.015・Noto Sans Symbols 2 2.008・Noto Sans Symbols 2.003・Noto Emoji 3.002・Noto Sans KR 2.004・Noto Sans SC 2.004 から日本語フォントにない文字を追加（`tools/build-font.py`） | https://github.com/google/fonts | SIL Open Font License 1.1 (`fonts/OFL.txt`) |

PDF.js includes bundled support files in `vendor/cmaps`, `vendor/standard_fonts`, and `vendor/wasm`. Their packaged license and notice files are retained in those directories.

The extension-specific source may be used and modified for the user's own purposes. Third-party components retain their respective licenses.
