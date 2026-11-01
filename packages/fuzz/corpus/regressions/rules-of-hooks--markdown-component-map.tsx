// rule: rules-of-hooks
// weakness: library-idiom
// source: synthetic
// verdict: pass
import Markdown from "react-markdown";
import { useMemo, useState } from "react";

export const CountPreview = () => {
  const components = useMemo(
    () => ({
      "count-item": () => {
        const [count] = useState(0);
        return <span>{count}</span>;
      },
    }),
    [],
  );
  return <Markdown components={components}>{"count"}</Markdown>;
};
