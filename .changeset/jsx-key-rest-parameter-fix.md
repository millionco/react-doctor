---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

fix(jsx-key): skip key-before-spread check for rest parameter spreads

The `jsx-key` rule's `checkKeyMustBeforeSpread` check now correctly identifies rest parameters from component props destructuring and skips the "key before spread" warning for these cases.

**Fixed pattern** (no longer reports):

```tsx
const Component = ({ prop, ...rest }) => items.map((item) => <div key={item.id} {...rest} />);
```

Rest parameters cannot contain a `key` prop by definition, so placing `key` before `{...rest}` is safe and common in React components.

**Still reports** (as intended):

- Arbitrary identifiers: `<div key={id} {...someVar} />`
- Call results: `<div key={id} {...getProps()} />`
- Local variables: `const props = {}; <div key={id} {...props} />`

Closes #1078
