# Third-party notices

## multilingual-e5-small

SES Agent Desktop includes a quantized ONNX conversion of
`intfloat/multilingual-e5-small`, distributed from
`Xenova/multilingual-e5-small` at revision
`761b726dd34fb83930e26aab4e9ac3899aa1fa78`.

- Upstream model: https://huggingface.co/intfloat/multilingual-e5-small
- Packaged conversion: https://huggingface.co/Xenova/multilingual-e5-small
- License identifier: MIT
- Runtime: local-only; remote model loading and network access are disabled.

The model's license and upstream notices remain applicable. This notice does
not change or replace those terms.

## japanese-reranker-tiny-v2

SES Agent Desktop includes platform-specific qint8 ONNX weights from
`hotchpotch/japanese-reranker-tiny-v2` at revision
`ba95175a4d53058816b971f31929f10c5cad8560`.

- Upstream model: https://huggingface.co/hotchpotch/japanese-reranker-tiny-v2
- License identifier: MIT
- Runtime: local-only; remote model loading and network access are disabled.

The model's license and upstream notices remain applicable. This notice does
not change or replace those terms.

## Tesseract.js and offline OCR language data

The Windows offline OCR worker includes fixed local copies of Tesseract.js
7.0.0, Tesseract.js Core 7.0.0, and Japanese/English traineddata from the
`@tesseract.js-data` packages. The runtime and language files are loaded from
the installed application only; CDN download and remote model fallback are
disabled.

- Tesseract.js: https://github.com/naptha/tesseract.js — Apache-2.0
- Tesseract.js Core: https://github.com/naptha/tesseract.js-core — Apache-2.0
- Tesseract.js data packages: https://github.com/naptha/tessdata — MIT

The upstream license files and notices remain applicable. This notice does not
change or replace those terms.
