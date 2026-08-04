import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

interface FormShellProperties {
  children: ReactNode;
}

const InnerFormShell = ({ children }: FormShellProperties) => <form>{children}</form>;

const FormShell = (properties: FormShellProperties) => <InnerFormShell {...properties} />;

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => (
  <FormShell>
    <SubmitButton />
  </FormShell>
);
