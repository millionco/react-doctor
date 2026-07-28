import { useFormStatus } from "react-dom";

const SubmitOrder = () => {
  const { data, method, pending } = useFormStatus();
  return (
    <>
      <button type="submit" disabled={pending}>
        {pending ? "Saving order" : "Save order"}
      </button>
      <output>{data ? `${method}:${String(data.get("sku"))}` : "idle"}</output>
    </>
  );
};

const saveOrder = (formData: FormData) => {
  String(formData.get("sku"));
};

export const Checkout = () => (
  <form action={saveOrder}>
    <label>
      SKU
      <input name="sku" defaultValue="react-book" />
    </label>
    <SubmitOrder></SubmitOrder>
  </form>
);
