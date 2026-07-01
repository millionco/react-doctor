---
"oxlint-plugin-react-doctor": patch
---

fix(react-builtins): eliminate false positives across builtin DOM/JSX rules

Harden the react-builtins rules against false positives on real-world code:

- `button-has-type`, `iframe-missing-sandbox`, `checked-requires-onchange-or-readonly`: a JSX or `createElement` spread (`{...props}`) can forward the "missing" attribute at runtime, so these rules no longer report an attribute they cannot see. `button-has-type` also resolves locally-bound and destructured/renamed `type` props, and treats explicitly nullish `createElement` props (`null` / `undefined` / `void 0`) as missing.
- `no-find-dom-node`: a bare `findDOMNode(...)` is flagged only when it is imported from `react-dom`, so a local helper of the same name is left alone.
- `no-is-mounted`, `no-this-in-sfc`: fire only inside an actual React component, so a plain class that exposes an `isMounted` method or an ES5 constructor keeps its real `this`.
- `no-call-component-as-function`, `no-unstable-nested-components`: a capitalized helper that is only ever called `Name()` (never instantiated as an element) is treated as an inline render helper, not a component.
- `rules-of-hooks`: a named function whose own scope issues several hook calls is treated as a custom hook / factory body even when its name breaks the `useXxx` / PascalCase convention (Solid→React ports name these `init` / `create*`).
- `exhaustive-deps`: a zero-arg accessor call (`foo()`) listed in the deps array now matches the captured accessor instead of being dropped as a complex dependency.
- `jsx-no-script-url`: the `javascript:` match is anchored to the URL start, so an ordinary `https:` link that merely contains `JavaScript:` deeper in its path is not flagged.
- `jsx-no-comment-textnodes`: an interpolated `//` separator glyph (`{used} // {total} GB`) is no longer mistaken for a `// comment`.
- `no-string-false-on-boolean-attribute`: custom elements (hyphenated tag names) own their attribute semantics and are skipped.
- `void-dom-elements-no-children`, `no-danger-with-children`: whitespace-with-newline text, `{/* comment */}`, and `{undefined}` / `{null}` no longer count as meaningful children; `void-dom-elements-no-children` also ignores nullish positional children in `createElement` (`createElement("img", props, null)`).
- `no-unknown-property`: `transform-origin` is allowed on every transformable SVG element, not just `<rect>`.
