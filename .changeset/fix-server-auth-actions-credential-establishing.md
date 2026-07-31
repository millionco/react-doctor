---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

fix(server-auth-actions): skip credential-establishing actions via SDK detection

The `server-auth-actions` rule now correctly skips server actions that perform credential-establishing operations (signup, signin, OTP verification, password reset) by detecting calls to auth SDK methods like `supabase.auth.signUp()`, `auth.signInWithPassword()`, and `auth.verifyOtp()`. These actions legitimately run for anonymous callers, so requiring authentication would be incorrect.

This resolves the documented false positive where credential-establishing endpoints were incorrectly flagged as unauthenticated privileged operations.

Closes #1538
