---
"react-doctor": patch
---

Show the "Add React Doctor to CI" and "install React Doctor" pitches once per repo instead of on every scan.

The post-scan handoff re-asked the CI question on every run, and the agent install hint re-printed every run because its opt-out store was built but never written. Both now record a per-repo answer (reusing the existing once-per-repo `Conf` pattern) and stay quiet afterward — the first-run experience is unchanged, only the repetition stops.

The agent copy-prompt no longer carries the CI marketing preamble at all. The interactive handoff prompt is now the single once-per-repo pitch, so the agent is never instructed to re-ask what the user was just asked — capable agents were flagging that preamble as social-engineering and it was eroding trust in the actual diagnostics.
