// rule: no-set-state-after-await-in-effect
// weakness: wrapper-transparency
// source: synthetic
// verdict: fail

import { useCallback, useEffect, useRef, useState } from "react";

interface CallbackInput {
  id: string;
}

declare const load: (id: string) => Promise<string>;

export const useCallbackValue = ({ id }: CallbackInput) => {
  const [value, setValue] = useState("");
  const update = useCallback(async () => {
    const result = await load(id);
    setValue(result);
  }, [id]);
  const currentUpdate = useRef(update);
  useEffect(() => {
    currentUpdate.current = update;
  }, [update]);
  useEffect(() => {
    currentUpdate.current();
  }, [id]);
  return value;
};
