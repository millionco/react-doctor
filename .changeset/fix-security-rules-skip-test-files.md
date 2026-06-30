---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Stop `no-eval` and `auth-token-in-web-storage` from firing in non-production files

`eval` / `new Function` / a stringy `setTimeout`, and a token written to web
storage, are only vulnerabilities in code that ships to users. Both rules now
skip test, spec, fixture, story, and script files (`isTestlikeFilename`), so a
`new Function(...)` inside a `*.test.ts` or a throwaway token in `__tests__/` is
no longer reported. The rules stay fully enabled in production code.
