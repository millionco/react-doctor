// rule: no-pass-live-state-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useCallback, useEffect, useState } from "react";
export function Child({ accountId }) {
  const [count] = useState(0);
  const read = useCallback(
    async (value) => {
      console.log(accountId, value);
    },
    [accountId],
  );
  useEffect(() => {
    void read(count);
  }, [read, count]);
  return null;
}
