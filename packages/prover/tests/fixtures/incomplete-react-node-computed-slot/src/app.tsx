import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

interface FormShellProperties {
  children: ReactNode;
  slotName: string;
  [propName: string]: ReactNode;
}

const FormShell = (properties: FormShellProperties) => (
  <form>{properties[properties.slotName]}</form>
);

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => (
  <FormShell slotName="children">
    <SubmitButton />
  </FormShell>
);
