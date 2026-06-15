---
"oxlint-plugin-react-doctor": patch
---

Add 3 new rules (mining batch 2), each validated with an OSS noise sweep (0 false positives across ~2,800 diagnostics in react-use, radix-ui/primitives, excalidraw, mantine):

- `no-document-write` (Performance): `document.write()`/`document.writeln()` blocks parsing and is ignored or wipes the page after load.
- `no-sync-xhr` (Performance): a synchronous `XMLHttpRequest` (`.open(method, url, false)`) freezes the main thread until the request finishes.
- `no-string-false-on-boolean-attribute` (Bugs): `disabled="false"` and friends pass the string `"false"`, which is truthy, so the boolean attribute is applied even when you wrote "false". Targets a curated set of true HTML boolean attributes on intrinsic elements; excludes enumerated attrs (`aria-*`, `contentEditable`, `draggable`, `spellCheck`) and custom components.
