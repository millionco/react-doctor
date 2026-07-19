// rule: no-nondeterministic-id-value-in-render-body
// weakness: name-heuristic
// source: adversarial audit of render/data-safety rules
import { nanoid } from "nanoid";
export const Button = () => {
  const label = nanoid();
  return <button aria-label={label} />;
};
