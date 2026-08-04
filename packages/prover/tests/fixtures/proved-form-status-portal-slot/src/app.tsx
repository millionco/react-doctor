import { useFormStatus } from "react-dom";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

interface FormShellProperties {
  children: ReactNode;
}

const FormShell = ({ children }: FormShellProperties) => (
  <form>{createPortal(children, document.body)}</form>
);

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => (
  <FormShell>
    <SubmitButton />
  </FormShell>
);
