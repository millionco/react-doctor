import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

interface ShellProperties {
  children: ReactNode;
}

const InnerShell = ({ children }: ShellProperties) => <>{children}</>;

const OuterFormShell = ({ children }: ShellProperties) => (
  <form>
    <InnerShell>{children}</InnerShell>
  </form>
);

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => (
  <OuterFormShell>
    <SubmitButton />
  </OuterFormShell>
);
