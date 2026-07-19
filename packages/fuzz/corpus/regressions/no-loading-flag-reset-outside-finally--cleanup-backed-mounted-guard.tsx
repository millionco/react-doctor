// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: PR #1402 Daytona parity audit (yoanbernabeu/openbento BlockPreview)
import { useEffect, useState } from "react";

export const FeedPreview = () => {
  const [, setIsLoading] = useState(false);
  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      try {
        await fetch("/feed");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    void load();
    return () => {
      isMounted = false;
    };
  }, []);
  return null;
};
