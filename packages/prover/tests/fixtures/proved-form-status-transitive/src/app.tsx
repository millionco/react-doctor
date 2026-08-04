import { useFormStatus as useReactFormStatus } from "react-dom";

const useCheckoutFormStatus = () => useReactFormStatus();

const CheckoutControls = () => {
  const { pending } = useCheckoutFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Checking out" : "Checkout"}
    </button>
  );
};

const CheckoutFields = () => (
  <section>
    <label>
      Email
      <input name="email" type="email" />
    </label>
    <CheckoutControls />
  </section>
);

const submitCheckout = (formData: FormData) => {
  String(formData.get("email"));
};

export const Checkout = () => (
  <form action={submitCheckout}>
    <CheckoutFields />
  </form>
);
