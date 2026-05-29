---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Add the `no-prop-types` architecture rule. React 19 removed runtime `propTypes` validation entirely — React no longer reads `Component.propTypes`, so invalid props that used to log a console warning now pass silently. The rule flags `Component.propTypes = { ... }` assignments and `static propTypes` class fields on component-cased identifiers, and is version-gated to React 19+ (`requires: ["react:19"]`) so projects where `propTypes` still runs stay quiet. It steers users toward TypeScript prop types plus explicit runtime validation. See #460.
