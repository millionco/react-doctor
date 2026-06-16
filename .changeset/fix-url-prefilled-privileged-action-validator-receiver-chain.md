---
"oxlint-plugin-react-doctor": patch
---

Fix `url-prefilled-privileged-action` false positive when a validating helper
wraps a read behind a receiver chain. The validator-suppression lookbehind only
recognized `validator(searchParams.get(...))` or `validator(new URLSearchParams(...))`
directly — real code reads through a receiver (`sanitizeNext(url.searchParams.get(...))`,
`validateNext(request.nextUrl.searchParams.get(...))`), and that intervening `url.`
broke the match so validated reads kept firing. The lookbehind now allows an optional
receiver member-chain between the helper's `(` and the read.
