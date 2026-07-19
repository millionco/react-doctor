// rule: valtio-no-snapshot-in-callback
// weakness: library-idiom
// source: adversarial-review

import { proxy, useSnapshot } from "valtio";

const state = proxy({ count: 0 });

export const Counter = () => {
  const snapshot = useSnapshot(state);
  const handleClick = () => console.log(snapshot.count);
  const aliasedHandler = handleClick;
  return <button onClick={aliasedHandler}>Read</button>;
};
