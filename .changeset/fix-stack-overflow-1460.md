---
"@react-doctor/core": patch
"react-doctor": patch
---

Fix stack overflow in project discovery when analyzing circular config references. The issue manifested when config files contained deeply nested parenthesized expressions, circular object spreads, or self-referential bindings during React Compiler detection.
