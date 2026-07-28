import { useFormStatus } from "react-dom";

interface FormShellProperties {
  children?: unknown;
}

const FormShell = ({ children }: FormShellProperties) => <form>{children}</form>;

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => (
  <FormShell>
    <SubmitButton />
  </FormShell>
);
