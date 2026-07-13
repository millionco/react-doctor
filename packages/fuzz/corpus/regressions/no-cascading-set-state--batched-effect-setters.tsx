// rule: no-cascading-set-state
// weakness: runtime-semantics
// source: anl331/goey-toast@0dafb8ff — synchronous effect setters share one React commit
import { useEffect, useState } from "react";

export const ExpandingToast = ({
  revision,
  showProgress,
}: {
  revision: number;
  showProgress: boolean;
}) => {
  const [isDismissing, setIsDismissing] = useState(true);
  const [showBody, setShowBody] = useState(false);
  const [progressKey, setProgressKey] = useState(0);

  useEffect(() => {
    setIsDismissing(false);
    setShowBody(true);
    if (showProgress) setProgressKey((previousProgressKey) => previousProgressKey + 1);
  }, [revision, showProgress]);

  return (
    <output>
      {String(isDismissing)}:{String(showBody)}:{progressKey}
    </output>
  );
};
