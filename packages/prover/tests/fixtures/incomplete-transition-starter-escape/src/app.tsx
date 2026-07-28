import { useTransition } from "react";

export const TransitionProvider = () => {
  const [, startTransition] = useTransition();
  const controls = { startTransition };

  return <div>{Boolean(controls)}</div>;
};
