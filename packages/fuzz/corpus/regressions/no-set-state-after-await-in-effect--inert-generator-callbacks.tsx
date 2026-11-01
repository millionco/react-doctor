// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: PR #2313 independent adversarial review
// verdict: pass
import { useEffect, useState } from "react";

export const InertGenerators = ({ id }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    queueMicrotask(function* () {
      yield setValue(id);
    });
    queueMicrotask(async function* () {
      yield setValue(id);
    });
    Promise.resolve(id).then(function* () {
      yield setValue(id);
    });
    Promise.reject(id).catch(async function* () {
      yield setValue(id);
    });
    Promise.resolve(id).finally(function* () {
      yield setValue(id);
    });
    Promise.resolve(id).then(async function* () {
      await load();
      yield setValue(id);
    });
    Promise.resolve(id).then(function* () {
      yield queueMicrotask(() => setValue(id));
    });
  }, [id]);
  return value;
};
