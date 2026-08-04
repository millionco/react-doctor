import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

interface FormShellProperties {
  children: ReactNode;
}

const FormShell = (properties: FormShellProperties) => <form>{properties["children"]}</form>;

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => (
  <FormShell>
    <SubmitButton />
  </FormShell>
);
