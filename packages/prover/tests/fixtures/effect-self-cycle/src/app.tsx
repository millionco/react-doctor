import { useEffect, useState } from "react";

export const Toggle = () => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(!enabled);
  }, [enabled]);

  return <p>{enabled ? "enabled" : "disabled"}</p>;
};
