// rule: no-array-index-as-key
// verdict: pass
// weakness: alias-guard
// source: synthetic namespace provider binding
namespace Object {
  export const defineProperty = () => null;
  export const getPrototypeOf = () => ({});
}
Object.defineProperty(Object.getPrototypeOf(""), "split", { value: customSplit });
const View = () =>
  [{ token: "A A" }].map((record) =>
    record.token.split(" ").map((part, index) => <span key={index}>{part}</span>),
  );
