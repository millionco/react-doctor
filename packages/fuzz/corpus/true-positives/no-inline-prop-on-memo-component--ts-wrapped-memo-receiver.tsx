// rule: no-inline-prop-on-memo-component
// weakness: wrapper-transparency
// source: fuzz seeds 1000050 and 1000085 in PR #1369

import React from "react";

const MemoizedItem = (React as any).memo(({ onSelect }) => (
  <button type="button" onClick={onSelect}>
    Select
  </button>
));

export const ItemPanel = () => <MemoizedItem onSelect={() => selectItem()} />;
