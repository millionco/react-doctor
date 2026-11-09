// rule: no-array-index-as-key
// weakness: alias-guard
// source: independently-authored-public-synthetic
// verdict: fail
import { mutate } from "./external";
const View = () =>
  [{ token: "A A" }].map((record) => {
    function expose() {
      interface record {}
      mutate(record);
    }
    expose();
    return record.token.split(" ").map((part, index) => <span key={index}>{part}</span>);
  });
