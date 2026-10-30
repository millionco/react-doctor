// rule: js-combine-iterations
// verdict: fail
// weakness: library-idiom
// source: independently authored unknown binder returning an array
import { Optional } from "@ephox/katamari";
export const selected = Optional.from(input)
  .bind((item) => [item])
  .filter((item) => item.enabled)
  .map((item) => item.label);
