// rule: no-array-index-as-key
// verdict: fail
// weakness: alias-guard
// source: synthetic erased TypeScript reflection binding
interface Object {}
Object.defineProperty(Object.getPrototypeOf(""), "split", { value: customSplit });
export const View = () =>
  [{ token: "A A" }].map((record) =>
    record.token.split(" ").map((part, index) => <span key={index}>{part}</span>),
  );
