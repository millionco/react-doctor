// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: PR #1499 Daytona parity, 53 candidate-introduced false positives
import { useEffect, useState } from "react";

export const User = ({ enabled, userId }) => {
  const [, setUser] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const run = async () => {
      const user = await loadUser(userId);
      if (cancelled) return;
      setUser(user);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  return null;
};
