---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

Exempt send/resend/notify/email mutations from cache invalidation requirement

The `query-mutation-missing-invalidation` rule now exempts mutations with `send`, `resend`, `notify`, or `email` in their name (hook name, binding name, or mutationFn callee). These operations are cache-effect-free - they send emails, notifications, codes, or invites without changing server data that cached queries could go stale on.

This resolves false positives on mutations like `useSendMagicLink()`, `useResendVerificationCode()`, `useNotifyUser()`, and `useEmailInvite()`.

Closes #1759
