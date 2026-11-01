// rule: no-array-index-as-key
// verdict: fail
// weakness: alias-guard
// source: synthetic provider binding namespace control
import type Object = require("./types");
Object.defineProperty(Object.getPrototypeOf(""), "split", { value: customSplit });
const View = () =>
  [{ token: "A A" }].map((record) =>
    record.token.split(" ").map((part, index) => <span key={index}>{part}</span>),
  );
