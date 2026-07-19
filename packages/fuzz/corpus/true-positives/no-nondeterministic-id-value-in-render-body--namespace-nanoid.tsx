// rule: no-nondeterministic-id-value-in-render-body
// weakness: alias-guard
import * as ids from "nanoid";

export const Field = () => {
  const id = ids.nanoid();
  return <input id={id} />;
};
