---
"oxlint-plugin-react-doctor": patch
---

Remove `query-destructure-result` rule — it was based on a false premise about TanStack Query's tracked-property optimization. According to TanStack Query's official documentation, the proxy's get trap is invoked by accessing a property "either via destructuring or by accessing it directly." This means both `const query = useQuery(...); return query.data` and `const { data } = useQuery(...); return data` track only the `data` property equally well. The rule incorrectly flagged the former as a performance issue when it is actually valid. The only problematic pattern — rest destructuring (`const { data, ...rest } = useQuery(...)`) — is already correctly handled by the separate `query-no-rest-destructuring` rule.
