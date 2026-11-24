import { useLayoutEffect, useState } from "react";

export const TimedIndicator = () => {
  const [visible, setVisible] = useState(true);
  useLayoutEffect(() => {
    const timeout = window.setTimeout(() => setVisible(!visible), 100);
    return () => window.clearTimeout(timeout ?? undefined);
  }, [visible]);
  return <span>{visible ? "On" : "Off"}</span>;
};
