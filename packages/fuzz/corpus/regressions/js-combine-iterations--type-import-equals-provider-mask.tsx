// rule: js-combine-iterations
// verdict: fail
// weakness: provider-erasure
// source: synthetic
import type Object = require("provider-types");
Object.defineProperty({}, "unrelated", { value: 42 });
import { Optional } from "@ephox/katamari";
const result = Optional.from(value)
  .filter((item) => item.active)
  .map((item) => item.label);
