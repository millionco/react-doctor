import { useCallback, useReducer } from "react";

const forceNextRender = (revision: number, _action: void): number => revision + 1;

export const RefreshButton = () => {
  const [, forceRender] = useReducer(forceNextRender, 0);
  const refresh = useCallback(() => forceRender(), [forceRender]);
  return (
    <button type="button" onClick={refresh}>
      refresh
    </button>
  );
};
