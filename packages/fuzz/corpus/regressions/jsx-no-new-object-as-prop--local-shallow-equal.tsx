// rule: jsx-no-new-object-as-prop
// weakness: name-heuristic
// source: PR #1369 adversarial review

import { memo } from "react";

const shallowEqual = (previousProps, nextProps) => previousProps.id === nextProps.id;
const MemoizedItem = memo(({ foo }) => <div>{foo.label}</div>, shallowEqual);

export const ItemPanel = ({ label }) => <MemoizedItem id="item" foo={{ label }} />;
