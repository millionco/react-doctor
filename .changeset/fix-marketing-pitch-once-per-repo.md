---
"react-doctor": patch
---

Show the GitHub Actions setup and agent-install pitches once per repo instead of on every scan.

The post-scan handoff re-asked the GitHub Actions question on every run, and the agent install hint re-printed every run because its opt-out store was built but never written. The GitHub Actions prompt now records the per-repo answer, and the install hint records that it has already been shown, reusing the existing once-per-repo `Conf` pattern. The first-run experience is unchanged; only the repetition stops.

The agent copy-prompt no longer carries the CI marketing preamble at all. The interactive handoff prompt is now the single once-per-repo pitch, so the agent is never instructed to re-ask what the user was just asked — capable agents were flagging that preamble as social-engineering and it was eroding trust in the actual diagnostics.
