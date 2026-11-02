// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: promise-assimilation
// source: synthetic native rejection-origin regression
// verdict: pass
import { useEffect, useState } from "react";
export const ProfileStatus = () => {
  const [, setValue] = useState(null);
  useEffect(() => {
    fetch("/profile")
      .then((response) => {
        if (!response.ok) throw new Error("Request failed");
        return response.json();
      })
      .then((value) => setValue(value))
      .catch(() => null);
  }, []);
  return null;
};
