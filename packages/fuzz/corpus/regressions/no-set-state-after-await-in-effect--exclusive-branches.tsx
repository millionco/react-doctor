// rule: no-set-state-after-await-in-effect
// weakness: control-flow
import { useEffect, useState } from "react";

export const ExclusiveEffect = ({ shouldLoad }: { shouldLoad: boolean }) => {
  const [, setValue] = useState(0);
  useEffect(() => {
    const run = async () => {
      if (shouldLoad) await load();
      else setValue(1);
    };
    void run();
  }, [shouldLoad]);
  return null;
};
