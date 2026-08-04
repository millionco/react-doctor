import { useActionState, useOptimistic } from "react";

interface CartState {
  confirmedQuantity: number;
  message: string;
}

const updateCart = async (previousState: CartState, formData: FormData): Promise<CartState> => {
  const quantity = Number(formData.get("quantity"));
  await Promise.resolve();
  return {
    confirmedQuantity: previousState.confirmedQuantity + quantity,
    message: `${quantity} tickets added`,
  };
};

export const Checkout = () => {
  const [cart, updateCartAction, isPending] = useActionState(updateCart, {
    confirmedQuantity: 0,
    message: "",
  });
  const [optimisticQuantity, setOptimisticQuantity] = useOptimistic(
    cart.confirmedQuantity,
    (currentQuantity, quantity: number) => currentQuantity + quantity,
  );
  const submitCart = (formData: FormData) => {
    setOptimisticQuantity(Number(formData.get("quantity")));
    updateCartAction(formData);
  };

  return (
    <form action={submitCart}>
      <label>
        Ticket quantity
        <input name="quantity" type="number" defaultValue="1" />
      </label>
      <button formAction={updateCartAction} type="submit" disabled={isPending}>
        Add directly
      </button>
      <button type="submit">Add optimistically</button>
      <output>{optimisticQuantity}</output>
      <p>{cart.message}</p>
    </form>
  );
};
