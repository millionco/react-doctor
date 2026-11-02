---
"oxlint-plugin-react-doctor": patch
---

Accept guarded subscriptions created after a promise resolves when the effect cleanup cancels late work and releases the retained handle. This supports nullable cleanup with optional chaining, direct null checks, and logical AND guards, including Expo Accelerometer availability checks.

Keep reporting missing cancellation, skipped releases, overwritten handles, repeated acquisition, and opaque thenable producers.
