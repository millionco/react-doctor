// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
import { useEffect, useState } from "react";

export const ValueLoader = ({ id }: { id: string }) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    let load = async () => {
      await fetch(`/value/${id}`);
      setValue(id);
    };
    load = async () => {};
    void load();
  }, [id]);
  return null;
};
