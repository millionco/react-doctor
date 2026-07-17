// rule: no-adjust-state-on-prop-change
// weakness: subscription-driven-effect
// source: PR #1361 review

import { useEffect, useState } from "react";

interface FeedSource {
  subscribe: (listener: () => void) => () => void;
}

export const Feed = ({ source }: { source: FeedSource }) => {
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
    source.subscribe(() => setSelection("updated"));
  }, [source]);

  return <div>{selection}</div>;
};
