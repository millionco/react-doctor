// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 deep precision review

import { useEffect, useState } from "react";

export const Cursor = () => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const intervalId = setInterval(() => setVisible(!visible), 500);
    return () => clearInterval(intervalId);
  }, [visible]);
  return <span>{visible}</span>;
};
