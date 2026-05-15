---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Fix trust-breaking false positives in `server-auth-actions` (issue #239).
The rule used to recognise auth calls only when the callee was a bare
`Identifier` — `auth()`, `getSession()`, `getUser()`. Every member-expression
flavour slipped through and flagged the whole server action. One reporter
hit 139 false positives, essentially every server action in the repo.

`containsAuthCheck` now delegates to the existing `getCalleeName` utility,
which resolves the final property name of a `MemberExpression` callee the
same way it resolves an `Identifier` callee. The rule now accepts all of
these as a valid auth gate:

- `await auth0.getSession()` (the verbatim repro) and the non-awaited form.
- `await supabase.auth.getSession()` and other chained member calls.
- `await clerkClient.getUser(userId)`.
- `await auth0?.getSession()` (optional chaining).
- The original `await auth()` / `await getSession()` Identifier forms.

The rule still flags server actions that have no auth-related call inside
the first `AUTH_CHECK_LOOKAHEAD_STATEMENTS` (10) statements.

Closes #239. Supersedes PR #240.
