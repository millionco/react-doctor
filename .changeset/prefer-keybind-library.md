---
"oxlint-plugin-react-doctor": patch
---

Add the `prefer-keybind-library` rule (opt-in draft, `defaultEnabled: false`). It flags a hand-rolled keyboard shortcut, a `keydown`/`keyup`/`keypress` `addEventListener` whose handler compares a `KeyboardEvent` key-identity property (`event.key === "k"`, `switch (event.code)`, `["j","k"].includes(event.key)`), and recommends a dedicated keybind library (react-hotkeys-hook by default, or one the file already imports such as tinykeys, hotkeys-js, mousetrap, `@mantine/hooks`, or `@github/hotkey`). The detector stays quiet for the look-alikes a keybind library does not replace: input-modality detection that reads only modifier flags (focus-visible polyfills) and Tab focus trapping whose only key check is Tab (`=== "Tab"`, `=== KEYS.TAB`, `keyCode === 9`). Validated against 7 large open-source React codebases with no false positives.
