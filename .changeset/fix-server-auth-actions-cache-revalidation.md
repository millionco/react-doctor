---
"oxlint-plugin-react-doctor": patch
---

fix: stop flagging non-privileged server actions in server-auth-actions

`server-auth-actions` flagged any exported server action without an auth check,
including actions that touch no protected data. It now exempts an action whose
body only:

- busts the Next.js cache — `revalidateTag`, `revalidatePath`, `expireTag`,
  `expirePath`, and the `unstable_` variants, and/or
- navigates — `redirect`, `permanentRedirect`, `notFound`, `forbidden`,
  `unauthorized`.

An unauthenticated caller gains nothing by invoking such actions, so requiring
an auth guard was a false positive.

The exemption is deliberately conservative — the body must contain at least one
cache- or navigation call (matched only as a bare imported identifier, never a
same-named method like `obj.redirect()`) and **no** other effect. Any DB query,
`fetch`, imported helper, raw-SQL tagged template (`sql\`DELETE …\``),
constructor, or assignment keeps the action flagged, so a genuinely sensitive
action is never silently allowed through.
