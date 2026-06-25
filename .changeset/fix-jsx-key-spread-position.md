---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Fix `jsx-key`'s spread-overwrites-`key` check to key off the spread's position. A `{...spread}` can only clobber an explicit `key` when it appears _after_ the key — the later attribute wins under the classic runtime (`{ key, ...spread }`) and React falls back to `createElement` under the automatic runtime, so the later spread wins there too. The rule now reports `<App key="x" {...spread} />` (and the sandwiched `<App {...a} key="x" {...b} />`) and stays silent on `<App {...spread} key="x" />`, which previously produced a false positive. Spreads of object literals that provably carry no `key` (e.g. `{...{}}`, `{...{ className }}`) are never treated as overwriting.
