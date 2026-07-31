// rule: no-set-state-after-await-in-effect
// weakness: conditional-wrapper
import { useEffect, useState } from "react";

export const ConditionalStart = ({ enabled, id }: { enabled: boolean; id: string }) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    const run = async () => {
      const value = await load(id);
      setValue(value);
    };
    const start = () => {
      if (enabled) void run();
    };
    start();
  }, [enabled, id]);
  return null;
};

export const MixedStarts = ({ enabled, id }: { enabled: boolean; id: string }) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    const run = async () => {
      const value = await load(id);
      setValue(value);
    };
    const start = () => {
      if (enabled) void run();
    };
    start();
    void run();
  }, [enabled, id]);
  return null;
};
