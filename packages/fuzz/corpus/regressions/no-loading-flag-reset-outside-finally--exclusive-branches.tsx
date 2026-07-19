// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
import { useState } from "react";

export const Loader = ({ shouldLoad }: { shouldLoad: boolean }) => {
  const [, setLoading] = useState(false);
  const run = async () => {
    if (shouldLoad) {
      setLoading(true);
      await load();
    } else {
      setLoading(false);
    }
  };
  return <button onClick={run} />;
};
