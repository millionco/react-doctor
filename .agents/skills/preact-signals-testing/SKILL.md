---
name: preact-signals-testing
description: Use when testing Preact Signals behavior in applications or the preactjs/signals repository, including Vitest, Testing Library, browser tests, module-level signal isolation, async updates, and signal-driven UI assertions.
---

# Preact Signals Testing

## Core Approach

Test behavior at the boundary that matters. For UI code, render the component and assert DOM output. For core signal graph behavior, test signals, computed values, effects, cleanup, and batching directly.

## App Test Patterns

Reset module-level signals between tests:

```ts
import { beforeEach, test, expect } from "vitest";
import { count } from "./state";

beforeEach(() => {
  count.value = 0;
});

test("increments", () => {
  count.value++;
  expect(count.value).toBe(1);
});
```

Prefer local signal factories when isolation is hard:

```tsx
function createCounterState() {
  const count = signal(0);
  return { count, increment: () => count.value++ };
}
```

For component tests, assert the DOM after user interaction rather than mocking signals:

```tsx
render(<Counter />);
await user.click(screen.getByRole("button", { name: /increment/i }));
expect(screen.getByText("1")).toBeInTheDocument();
```

## Async And Effects

- Read the signal before `await` if the read should be tracked.
- Use Testing Library `findBy*` or `waitFor` for UI that updates after effects or async actions.
- Dispose manual `effect()` calls in test cleanup.
- Avoid hidden cross-test state from module-level signals by resetting them or importing fresh modules.

## Common Mistakes

- Testing only `signal.value` and missing the UI subscription behavior.
- Reusing module-level signals across tests without reset.
- Forgetting to unmount rendered components so effects keep running.
- Reading `.value` after `await` and expecting dependency tracking.
- Assuming React and Preact adapters have identical JSX attribute behavior.

## References

- Vitest: https://vitest.dev/
- Testing Library: https://testing-library.com/docs/
