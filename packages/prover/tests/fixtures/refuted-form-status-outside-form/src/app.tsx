import { useFormStatus } from "react-dom";

export const DetachedSubmit = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Save</button>;
};
