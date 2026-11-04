// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: PR #2313 independent adversarial review
// verdict: pass
import { useEffect, useState } from "react";

export const DefinedThen = ({ id }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    const pending = Promise.resolve(id);
    Object.defineProperty(pending, "then", { value: (callback) => callback(id) });
    pending.then((result) => setValue(result));
  }, [id]);
  return value;
};

export const AssignedThen = ({ id }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    const pending = Promise.resolve(id);
    Object.assign(pending, { then: (callback) => callback(id) });
    pending.then((result) => setValue(result));
  }, [id]);
  return value;
};

export const EscapedPromise = ({ id }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    const pending = Promise.resolve(id);
    installImmediateThen(pending);
    pending.then((result) => setValue(result));
  }, [id]);
  return value;
};
