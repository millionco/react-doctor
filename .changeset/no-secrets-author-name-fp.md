---
"oxlint-plugin-react-doctor": patch
---

fix(security): `no-secrets-in-client-code`'s variable-name heuristic no longer
matches `auth` inside `author`/`authors`/`authority` — a component identifier
like `TOP_PR_AUTHORS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER = "<uuid>"` is not a
credential. The credential words that contain "author"
(`authorization`, `authorised`) still match. Found by the fuzz FP oracle over
the real-world corpus.
