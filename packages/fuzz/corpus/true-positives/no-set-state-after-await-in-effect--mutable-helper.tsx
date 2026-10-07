// rule: no-set-state-after-await-in-effect
// weakness: mutable-helper
import { useEffect, useState } from "react";

interface LoaderProps {
  id: string;
}

export const LetLoader = ({ id }: LoaderProps) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    let load = async () => {
      await fetch(`/value/${id}`);
      setValue(id);
    };
    void load();
  }, [id]);
  return null;
};

export const VarLoader = ({ id }: LoaderProps) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    var load = async function () {
      await fetch(`/value/${id}`);
      setValue(id);
    };
    void load();
  }, [id]);
  return null;
};
