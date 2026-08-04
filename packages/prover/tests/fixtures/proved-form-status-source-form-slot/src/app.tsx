import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

interface IdentityProperties {
  children: ReactNode;
}

const Identity = ({ children }: IdentityProperties) => <>{children}</>;

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => (
  <Identity>
    <form>
      <SubmitButton />
    </form>
  </Identity>
);
