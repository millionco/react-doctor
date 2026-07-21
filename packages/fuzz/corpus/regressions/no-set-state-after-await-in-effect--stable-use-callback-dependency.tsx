// rule: no-set-state-after-await-in-effect
// weakness: framework-gating
// source: binaricat/Netcatty application/state/useVaultState.ts
// verdict: pass

import { useCallback, useEffect, useState } from "react";

export const StableUseCallbackDependency = () => {
  const [, setValue] = useState(0);
  const updateValue = useCallback(() => undefined, []);

  useEffect(() => {
    const initialize = async () => {
      const value = await loadValue();
      setValue(value);
    };
    void initialize();
  }, [updateValue]);

  return null;
};
