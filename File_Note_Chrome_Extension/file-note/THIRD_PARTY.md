# Third-party components

Runtime dependencies are bundled locally; the extension executes no remotely hosted code.

| Component | Version | Source | License |
|---|---|---|---|
| PDF.js / pdfjs-dist | 5.6.205 | https://github.com/mozilla/pdf.js | Apache-2.0 (`vendor/PDFJS-LICENSE`) |
| pdf-lib | 1.17.1 | https://github.com/Hopding/pdf-lib | MIT (`vendor/PDFLIB-LICENSE.md`) |
| @pdf-lib/fontkit | 1.1.1 | https://github.com/Hopding/fontkit | MIT (`vendor/FONTKIT-LICENSE`) |
| Noto Sans JP Regular | Static TTF | https://github.com/notofonts/noto-cjk | SIL Open Font License 1.1 (`fonts/OFL.txt`) |

PDF.js includes bundled support files in `vendor/cmaps`, `vendor/standard_fonts`, and `vendor/wasm`. Their packaged license and notice files are retained in those directories.

The extension-specific source may be used and modified for the user's own purposes. Third-party components retain their respective licenses.
