import { useActionState } from "react";

export const Cart = () => {
  const [quantity, updateQuantity] = useActionState(
    (_previousQuantity: number, nextQuantity: number) => nextQuantity,
    1,
  );
  const actions = { updateQuantity };
  return <output data-action-count={Object.keys(actions).length}>{quantity}</output>;
};
