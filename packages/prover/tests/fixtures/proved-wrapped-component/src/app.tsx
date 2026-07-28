import { memo, useState } from "react";

export const MemoCounter = memo(() => {
  const [count] = useState(0);
  return <p>{count}</p>;
});
