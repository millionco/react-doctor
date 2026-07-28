import { useFormStatus } from "react-dom";

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

const submitOrder = () => {};

export const Checkout = () => (
  <>
    <form action={submitOrder}>
      <SubmitButton />
    </form>
    <SubmitButton />
  </>
);
