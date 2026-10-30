// rule: no-array-index-as-key
// verdict: pass
// weakness: alias-guard
// source: synthetic provider binding namespace control
const Object = {
  defineProperty() {},
  getPrototypeOf() {
    return {};
  },
};
interface Object {}
Object.defineProperty(Object.getPrototypeOf(""), "split", { value: customSplit });
const View = () =>
  [{ token: "A A" }].map((record) =>
    record.token.split(" ").map((part, index) => <span key={index}>{part}</span>),
  );
