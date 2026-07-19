// rule: no-set-state-after-await-in-effect
// weakness: cancellation-guard
import { useEffect, useState } from "react";

export const StaleEffect = ({ id }: { id: string }) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    let _cancelled = false;
    const run = async () => {
      await load(id);
      setValue(id);
    };
    void run();
    return () => {
      _cancelled = true;
    };
  }, [id]);
  return null;
};
