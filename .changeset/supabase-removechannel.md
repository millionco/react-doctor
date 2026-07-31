---
"oxlint-plugin-react-doctor": patch
---

fix(effect-needs-cleanup): recognize Supabase removeChannel/removeAllChannels and Jitsi dispose cleanup

The rule now correctly recognizes:
- `supabase.removeChannel(channel)` as valid cleanup for Supabase Realtime subscriptions
- `supabase.removeAllChannels()` as global cleanup for all Supabase channels
- `api.dispose()` as valid cleanup for Jitsi ExternalAPI (already worked via UNIVERSAL_RELEASE_VERB_NAMES)
- `channel.unsubscribe()` for Supabase channels created with `.on()` chains

This eliminates false positives when using the documented Supabase cleanup methods, which are stronger than the previously-recognized `channel.unsubscribe()` pattern (removeChannel both unsubscribes and deregisters the channel).

Fixes #1539
