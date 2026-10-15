---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Recognize unshadowed `global.document` DOM receivers so focus effects can clear their request flags without a false state-adjustment warning. Preserve warnings for shadowed globals and unrelated prop resets.
