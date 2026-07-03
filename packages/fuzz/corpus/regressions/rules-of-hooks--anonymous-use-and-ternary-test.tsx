// rule: rules-of-hooks
// weakness: anonymous-callback-use, ternary-test-position
// source: differential vs eslint-plugin-react-hooks
import { use } from "react";
import { useFlag } from "./flags";

declare const somePromise: Promise<number>;
declare const register: (callback: () => number) => void;

register(() => {
  const value = use(somePromise);
  return value;
});

export const FlagLabel = () => {
  const label = useFlag("beta") ? "beta" : "stable";
  return <span>{label}</span>;
};
