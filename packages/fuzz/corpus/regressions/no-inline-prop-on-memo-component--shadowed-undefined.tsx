// rule: no-inline-prop-on-memo-component
// weakness: name-heuristic
// source: PR #1369 adversarial review

import { memo } from "react";

const undefined = (previousProps, nextProps) => previousProps.id === nextProps.id;
const MemoizedRow = memo(
  ({ onSelect }) => (
    <button type="button" onClick={onSelect}>
      Select
    </button>
  ),
  undefined,
);

export const RowList = () => <MemoizedRow id="row" onSelect={() => selectRow()} />;
