import { createContext } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

const ContentContext = createContext<ReactNode>(null);

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Submit</button>;
};

export const Checkout = () => <ContentContext.Provider value={<SubmitButton />} />;
