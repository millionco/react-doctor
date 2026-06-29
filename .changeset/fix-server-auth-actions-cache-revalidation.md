---
"oxlint-plugin-react-doctor": patch
---

fix: stop flagging non-privileged server actions in server-auth-actions

`server-auth-actions` flagged any exported server action without an auth check,
including actions that touch no protected data. It now exempts an action whose
body only:

- busts the Next.js cache (`revalidateTag`, `revalidatePath`, `expireTag`,
  `expirePath`, and the `unstable_` variants),
- navigates (`redirect`, `permanentRedirect`, `notFound`, `forbidden`,
  `unauthorized`), and/or
- reads its own client-supplied arguments (e.g. `revalidateTag(formData.get("tag"))`).

An unauthenticated caller gains nothing by invoking such actions, so requiring
an auth guard was a false positive.

The exemption is conservative: the body must contain at least one cache- or
navigation call and no call that could touch external state. Any other
invocation — a DB write, a `fetch`, an imported helper, a cookie mutation —
keeps the action flagged, so a genuinely sensitive action is never silently
allowed through.
