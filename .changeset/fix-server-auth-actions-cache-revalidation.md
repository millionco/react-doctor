---
"oxlint-plugin-react-doctor": patch
---

fix: stop flagging cache-revalidation-only server actions in server-auth-actions

A server action whose entire body is a Next.js cache-invalidation call
(`revalidateTag`, `revalidatePath`, `expireTag`, `expirePath`, and the
`unstable_` variants) reads no data and mutates no records, so an
unauthenticated caller gains nothing by invoking it. These actions are no longer
reported as missing an auth check.

The exemption is conservative: the action must contain at least one revalidation
call and no other call expression. Any additional invocation (a DB write, a
`fetch`, an imported helper) keeps the action flagged, so a genuinely sensitive
action is never silently allowed through.
