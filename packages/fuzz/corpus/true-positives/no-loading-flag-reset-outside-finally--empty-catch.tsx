// rule: no-loading-flag-reset-outside-finally
// weakness: rejection-handler-shape
import { useState } from "react";

export const Loader = () => {
  const [, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    await fetch("/items").catch();
    setLoading(false);
  };
  return <button onClick={run} />;
};
