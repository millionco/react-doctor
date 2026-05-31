---
"react-doctor": patch
---

Redact secrets and PII from diagnostic output. Every diagnostic's `message`/`help` is now scrubbed for API keys, tokens, private keys, JWTs, credentialed URLs, and email addresses before it reaches the terminal, the JSON report, or the score API — so react-doctor never echoes or transmits a secret embedded in your source. Provider tokens keep their non-secret, type-identifying prefix (e.g. `sk_live_<redacted>`, `ghp_<redacted>`) so you can tell which credential leaked while the secret itself stays masked.
