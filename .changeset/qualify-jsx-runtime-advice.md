---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Qualify `react-in-jsx-scope` advice by the selected JSX transform. Missing a source-level `React` binding does not establish a runtime crash: automatic runtimes, custom factories, and build-injected factories can render JSX without an application `React` import. Detection and the opt-in default stay unchanged.
