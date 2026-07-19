// rule: valtio-no-snapshot-in-callback
// weakness: library-idiom
// source: pmndrs/valtio discussion #290

import { proxy, useSnapshot } from "valtio";

const state = proxy({ count: 0 });

export const Counter = () => {
  const snapshot = useSnapshot(state);
  return <button onClick={() => console.log(snapshot.count)}>Read</button>;
};
