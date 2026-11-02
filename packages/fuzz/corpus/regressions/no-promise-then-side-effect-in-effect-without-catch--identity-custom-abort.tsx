// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: promise-assimilation
// source: synthetic native rejection-origin regression
// verdict: fail
import { useEffect, useState } from "react";
export const AccountStatus = () => {
  const [, setValue] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/account", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Request failed");
        return response.json();
      })
      .then((value) => setValue(value))
      .catch((reason) => reason);
    return () => controller.abort(Promise.reject("custom abort reason"));
  }, []);
  return null;
};
