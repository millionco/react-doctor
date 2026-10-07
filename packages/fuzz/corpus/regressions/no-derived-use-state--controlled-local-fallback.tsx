// rule: no-derived-useState
// weakness: control-flow
// source: ReactBench fix-react-rdh-nteract-semiotic-a__BTorRet
// verdict: pass
import { useCallback, useState } from "react";

export const ControlledTree = ({ tree, activeId: controlledActiveId }) => {
  const [internalActiveId, setInternalActiveId] = useState(tree.id);
  const isControlled = controlledActiveId !== undefined;
  const activeId = isControlled ? controlledActiveId : internalActiveId;
  const selectItem = useCallback(
    (item) => {
      if (!isControlled) setInternalActiveId(item.id);
    },
    [isControlled],
  );

  return <Tree activeId={activeId} onSelect={selectItem} />;
};
