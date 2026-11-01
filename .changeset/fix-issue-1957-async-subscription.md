---
"oxlint-plugin-react-doctor": patch
---

Fix effect-needs-cleanup false positive for async subscriptions with nullable cleanup

Fixes a false positive where `effect-needs-cleanup` incorrectly reported subscriptions created in async callbacks (e.g., after `Promise.then()`) as never cleaned up, even when the cleanup function properly handled nullable cleanup with optional chaining (`subscription?.remove()`), explicit null checks, or logical AND guards (`subscription && subscription.remove()`).

The rule now correctly recognizes that subscriptions created in promise callbacks and assigned to nullable variables are properly cleaned up when:

1. The subscription variable is declared as nullable in the effect body
2. The cleanup function conditionally releases the subscription
3. The promise callback is invoked by the effect

This extends the existing async timer handling to also support async subscriptions, matching the common pattern used in libraries like Expo Sensors where availability must be checked asynchronously before subscribing.

Closes #1957
