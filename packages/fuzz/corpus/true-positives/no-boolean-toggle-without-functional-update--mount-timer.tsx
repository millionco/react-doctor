// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 deep precision review

import { useEffect, useState } from "react";

export const Cursor = () => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setInterval(() => setVisible(!visible), 500);
  }, []);
  return <span>{visible}</span>;
};
