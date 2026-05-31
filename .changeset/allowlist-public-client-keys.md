---
"react-doctor": patch
---

Stop flagging known public client keys in `no-secrets-in-client-code`. Keys that vendors design to ship in the browser bundle — RevenueCat public SDK keys (`appl_`/`goog_`/`amzn_`/`strp_`), Stripe/Clerk publishable keys (`pk_live_`/`pk_test_`), Supabase publishable keys (`sb_publishable_`), PostHog project keys (`phc_`), Stytch public tokens (`public-token-`), and Mapbox public access tokens (`pk.`) — are now allowlisted, so the variable-name heuristic no longer reports them as hardcoded secrets. Ambiguous shapes that can be either public or sensitive (Google/Firebase `AIza…` browser keys, and bare Supabase `anon`/`service_role` JWTs) are intentionally still flagged.
