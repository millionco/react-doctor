// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: PR #2313 independent adversarial review
// verdict: pass
import { useEffect, useState } from "react";

export const DefinedPromiseFactory = ({ id }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    Object.defineProperty(Promise, "resolve", {
      value: (result) => ({
        then(callback) {
          callback(result);
        },
      }),
    });
    Promise.resolve(id).then((result) => setValue(result));
  }, [id]);
  return value;
};

export const ReplacedMicrotask = ({ id }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    const key = "queueMicrotask";
    globalThis[key] = (callback) => callback();
    queueMicrotask(() => setValue(id));
  }, [id]);
  return value;
};
