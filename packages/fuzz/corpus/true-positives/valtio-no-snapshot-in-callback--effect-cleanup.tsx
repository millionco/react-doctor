// rule: valtio-no-snapshot-in-callback
// weakness: library-idiom
// source: adversarial-review

import { useEffect } from "react";
import { proxy, useSnapshot } from "valtio";

const state = proxy({ count: 0 });

export const Counter = () => {
  const snapshot = useSnapshot(state);
  useEffect(() => () => console.log(snapshot.count), []);
  return null;
};
