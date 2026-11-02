// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: promise-assimilation
// source: synthetic native rejection-origin regression
// verdict: fail
import { useEffect, useState } from "react";
declare const transform: (value: unknown) => unknown;
export const ItemStatus = () => {
  const [, setValue] = useState(null);
  useEffect(() => {
    fetch("/items")
      .then((response) => {
        if (!response.ok) throw new Error("Request failed");
        return response.json();
      })
      .then((value) => transform(value))
      .then((value) => setValue(value))
      .catch((reason) => reason);
  }, []);
  return null;
};
