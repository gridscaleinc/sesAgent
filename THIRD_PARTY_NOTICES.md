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

## gliner-x-small

SES Agent Desktop includes the int8-quantized ONNX export and tokenizer of
`knowledgator/gliner-x-small` at revision
`d51a0984d11084a55f9df3899d9dbf7704f580f5`, used only for local person-name
detection before any Cloud AI request. The model is built on `google/mt5-small`
(Apache-2.0).

- Upstream model: https://huggingface.co/knowledgator/gliner-x-small
- Authors: Knowledgator Engineering; GLiNER architecture by Urchade Zaratiana et al.
- Encoder: https://huggingface.co/google/mt5-small — Apache-2.0
- License identifier: Apache-2.0 (https://www.apache.org/licenses/LICENSE-2.0)
- Packaged files: `onnx/model_quantized.onnx`, `tokenizer.json`,
  `tokenizer_config.json`, `special_tokens_map.json`, `gliner_config.json`
  (unmodified; each pinned by SHA-256 in `model-manifest.json`)
- Runtime: ONNX Runtime (onnxruntime-node, MIT) and the Transformers.js
  tokenizer (@huggingface/transformers, Apache-2.0), in an isolated worker with
  network access denied; remote model loading is disabled.

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
