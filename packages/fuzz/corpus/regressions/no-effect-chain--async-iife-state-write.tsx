// rule: no-effect-chain
// weakness: control-flow
// source: PR #1182 React Bench AppFlowy-Web delta audit

import { useEffect, useState } from "react";

export const RelationItems = ({ loadView }) => {
  const [viewId, setViewId] = useState<string | null>(null);
  const [rows, setRows] = useState<unknown[]>([]);

  function loadViewId() {
    void (async () => {
      const view = await loadView();
      setViewId(view.id);
    })();
  }

  useEffect(loadViewId, [loadView]);
  useEffect(() => {
    if (viewId) setRows([]);
  }, [viewId]);

  return rows.length;
};
