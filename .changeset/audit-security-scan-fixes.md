---
"oxlint-plugin-react-doctor": patch
---

Security-scan accuracy fixes from a 20-day audit

- The shared comment/string stripper now recognizes regex literals, so a
  pattern like `/https:\/\//` no longer lexes as a line comment that blanks
  the rest of the line (hiding a real `eval(...)` from every pattern-scan
  rule), and a quote inside a regex no longer desyncs string tracking.
- An unbalanced quote (a JSX apostrophe: `Don't`) now closes at the line end
  instead of swallowing the rest of the file, bounding any lexer desync to a
  single line.
- `insecure-crypto-risk` now scans comment-stripped content, so `md5`/`DES`
  mentions in migration notes and TODOs no longer fire.
- `dangerous-html-sink`'s string-literal exemption is now escape-aware, so
  `el.innerHTML = "It\"s static content"` (or a single-quoted literal
  containing a double quote) is no longer flagged.
