---
"react-doctor": patch
---

Show the "Add React Doctor to CI" and "install React Doctor" pitches once per repo instead of on every scan.

The post-scan handoff re-asked the CI question (and re-embedded the CI upsell in the agent copy-prompt) on every run, and the agent install hint re-printed every run because its opt-out store was built but never written. All three now record a per-repo answer (reusing the existing once-per-repo `Conf` pattern) and stay quiet afterward — the first-run experience is unchanged, only the repetition stops.

This also removes the every-scan marketing preamble from the copy-prompt, which capable agents were flagging as social-engineering and which was eroding trust in the actual diagnostics.
