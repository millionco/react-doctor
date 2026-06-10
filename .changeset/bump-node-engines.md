---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Bump `engines.node` to `^20.19.0 || >=22.13.0` so the declared support range matches transitive dependencies (`eslint-scope@9`, `eslint-visitor-keys@5` require `^22.13.0`), preventing EBADENGINE warnings on npm and hard install failures on Yarn 1 under Node 22.12.x.
