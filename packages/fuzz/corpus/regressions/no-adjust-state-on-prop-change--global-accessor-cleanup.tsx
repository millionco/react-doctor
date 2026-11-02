// rule: no-adjust-state-on-prop-change
// weakness: binding-identity
// source: PR 2326 review, a global accessor read can execute real cleanup
// verdict: pass
import { useEffect, useState } from "react";

const connection = {
  closed: false,
  close() {
    this.closed = true;
  },
};

Object.defineProperty(globalThis, "cleanupSignal", {
  get() {
    connection.close();
  },
});

export const Selection = ({ itemId, cache }) => {
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    setSelection(null);
    cache.get(itemId);
    return () => cleanupSignal;
  }, [itemId, cache]);
  return selection;
};
