// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: alias-guard
import { useEffect, useState } from "react";

export const ValueLoader = () => {
  const [, setValue] = useState<Response | null>(null);
  let load = async () => fetch("/value");
  load = async () => new Response();
  useEffect(() => {
    load().then(setValue);
  }, []);
  return null;
};
