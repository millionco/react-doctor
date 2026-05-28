---
name: preact-forms-events
description: "Use when building or debugging Preact forms, controlled or uncontrolled inputs, onInput versus onChange, checkbox, radio, select, textarea behavior, hydration of form state, cursor preservation, or compat event normalization."
---

# Preact Forms and Events

Preact core follows DOM event semantics. Use `onInput` for per-keystroke text changes unless `preact/compat` is intentionally providing React-style normalization.

## Form Defaults

- Prefer uncontrolled inputs when the DOM can own the state.
- Use controlled inputs only when the rendered `value` or `checked` must be forced from component state.
- A controlled input must trigger a rerender when the DOM must be corrected. If rejected input does not change state, patch the DOM through a ref and restore selection.
- Use `defaultValue` and `defaultChecked` for initial DOM state that should not be controlled after mount.

## Events

- Text inputs and textareas: `onInput`.
- Checkbox/radio toggles: `onClick` or appropriate DOM change handling.
- Core `onChange` is the native commit/change event, not React's per-keystroke text event.
- `preact/compat` maps common React event names and behavior, but low-level UI libraries can still depend on synthetic event details.

## Examples

Uncontrolled (preferred):

```jsx
function Form() {
  const onSubmit = e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    console.log(data.get('email'));
  };
  return (
    <form onSubmit={onSubmit}>
      <input name="email" type="email" defaultValue="" />
      <button type="submit">Send</button>
    </form>
  );
}
```

Controlled (only when state must drive the DOM):

```jsx
import { useState } from 'preact/hooks';

function Upper() {
  const [value, setValue] = useState('');
  // onInput on every keystroke; uppercase transform forces a rerender.
  return (
    <input
      value={value}
      onInput={e => setValue(e.currentTarget.value.toUpperCase())}
    />
  );
}
```

## Hydration

SSR form controls are sensitive to initial attributes and live properties. Regression-prone surfaces: `value`, `checked`, `defaultValue`, `defaultChecked`, focus, cursor selection, textarea content, and select options across `hydrate()`. Assert them in integration tests.

Doc anchors: [Forms](https://preactjs.com/guide/v10/forms), [Differences to React](https://preactjs.com/guide/v10/differences-to-react).
