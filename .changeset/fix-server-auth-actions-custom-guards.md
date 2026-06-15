---
"oxlint-plugin-react-doctor": patch
---

Fix `server-auth-actions` false positives on custom auth guards (#829).

The rule only recognized a fixed list of auth function names, so a server action protected by a project's own guard — e.g. `await requireAdmin()` or `await getAdminSession()` — was wrongly flagged as callable by anyone. It now recognizes auth checks by naming **convention** as well: an assertive verb plus an auth noun (`requireAdmin`, `ensureSignedIn`, `checkPermission`, `assertUser`, `isAdmin`, `hasRole`), a getter plus a strong auth noun (`getServerAuthSession`, `getAdminSession`), and `current`/`my`/`own` qualifiers (`getCurrentUser`). Genuinely ambiguous names like `getUser` and `getToken` still require an auth-related receiver, so `analytics.getUser()` keeps firing the rule.
