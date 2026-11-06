---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Recognize timer cleanup through a private callback ref when its only render write preserves the cleanup callback and the timer handle cannot be replaced before teardown.
