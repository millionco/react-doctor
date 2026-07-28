import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

interface FormShellProperties {
  controls: ReactNode;
}

const FormShell = ({ controls }: FormShellProperties) => <form>{controls}</form>;

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => <FormShell controls={<SubmitButton />} />;
