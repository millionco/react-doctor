// rule: no-adjust-state-on-prop-change
// weakness: uninvoked-nested-external-work
// source: PR #1361 review

import { useEffect, useState } from "react";

interface FeedSource {
  subscribe: (listener: () => void) => () => void;
}

export const Feed = ({ itemId, source }: { itemId: string; source: FeedSource }) => {
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
    const _subscribeLater = () => source.subscribe(() => setSelection("updated"));
  }, [itemId, source]);

  return <div>{selection}</div>;
};
