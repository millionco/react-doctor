// rule: jsx-no-new-object-as-prop
// weakness: wrapper-transparency
// source: fuzz seed 1000269 in PR #1369

import React from "react";

const MemoizedItem = (React as any).memo(({ foo }) => <div>{foo.label}</div>);

export const ItemPanel = ({ label }) => <MemoizedItem foo={{ label }} />;
