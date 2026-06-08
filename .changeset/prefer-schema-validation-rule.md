---
"oxlint-plugin-react-doctor": patch
---

Add the `react-doctor/prefer-schema-validation` rule.

Flags hand-rolled runtime type/shape validation — a TypeScript type-predicate or assertion function (`value is User`, `asserts input is Config`), or a validator-named function (`isUser`, `validateConfig`, `assertX`, …) that checks an object's shape with two or more distinct `typeof` member checks — and recommends parsing the value once with a schema validator (Zod, Valibot, Yup) so the type and the runtime check stay in sync. Only `typeof param.member === "<tag>"` checks count, so polymorphic dispatch on the parameter itself, serializers without a validator name, checks inside nested functions, and dynamic computed members stay quiet.
