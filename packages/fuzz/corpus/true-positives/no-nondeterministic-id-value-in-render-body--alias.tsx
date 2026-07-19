// rule: no-nondeterministic-id-value-in-render-body
// weakness: alias-guard
import { nanoid } from "nanoid";
export const Field = () => {
  const generated = nanoid();
  const id = generated;
  return <input id={id} />;
};
