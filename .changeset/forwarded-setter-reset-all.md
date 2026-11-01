---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Report an effect that resets all state after a prop change through a transparent local setter helper, such as `assign(setKey, "")`, exactly where the direct reset is reported, including layout effects. A reload forwarded through the same helper from an asynchronous callback now counts as a loading lifecycle, and a handler that writes through the helper keeps the hidden-until-reset exemption. Imported, reassigned, asynchronous, deferred, conditional, and multi-statement helpers stay outside the proof.
