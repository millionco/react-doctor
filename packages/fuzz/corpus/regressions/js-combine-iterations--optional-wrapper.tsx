// rule: js-combine-iterations
// verdict: pass
// weakness: library-idiom
// source: independently authored canonical Optional wrapper
import { Optional } from "@ephox/katamari";
export const selected = Optional.from(input)
  .filter((item) => item.enabled)
  .map((item) => item.label);
