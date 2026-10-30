// rule: js-combine-iterations
// verdict: fail
// weakness: provider-erasure
// source: synthetic
declare const Object: any;
declare const require: any;
Object.defineProperty(require("@ephox/katamari").Optional, "from", { value: () => [] });
import { Optional } from "@ephox/katamari";
const result = Optional.from(value)
  .filter((item) => item.active)
  .map((item) => item.label);
