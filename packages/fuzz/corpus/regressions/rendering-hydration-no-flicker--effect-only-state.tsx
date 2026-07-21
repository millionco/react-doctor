// rule: rendering-hydration-no-flicker
// weakness: control-flow
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

import { useEffect, useState } from "react";

export const Sender = () => {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setInitialized(true);
  }, []);

  useEffect(() => {
    const handleOutsideClick = () => {
      if (initialized) handleBlur();
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [initialized]);

  return <textarea />;
};
