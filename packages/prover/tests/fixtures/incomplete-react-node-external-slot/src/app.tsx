import { ExternalShell } from "external-shell";
import { useFormStatus } from "react-dom";

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => (
  <ExternalShell>
    <SubmitButton />
  </ExternalShell>
);
