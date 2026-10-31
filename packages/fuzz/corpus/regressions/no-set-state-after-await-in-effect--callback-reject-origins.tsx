// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: synthetic
// verdict: pass

import { useCallback, useEffect, useState } from "react";

interface RejectionInput {
  id: string;
}

export const useNamespaceRejection = ({ id }: RejectionInput) => {
  const [value, setValue] = useState("");
  const promise = Promise;
  const update = useCallback(async () => {
    try {
      await promise.reject(id);
    } catch {
      return;
    }
    setValue(id);
  }, [id]);
  useEffect(() => {
    update();
  }, [id]);
  return value;
};

export const useMethodRejection = ({ id }: RejectionInput) => {
  const [value, setValue] = useState("");
  const reject = Promise.reject;
  const update = useCallback(async () => {
    try {
      await reject(id);
    } catch {
      return;
    }
    setValue(id);
  }, [id]);
  useEffect(() => {
    update();
  }, [id]);
  return value;
};

export const useBoundRejection = ({ id }: RejectionInput) => {
  const [value, setValue] = useState("");
  const reject = Promise.reject.bind(Promise);
  const update = useCallback(async () => {
    try {
      await reject(id);
    } catch {
      return;
    }
    setValue(id);
  }, [id]);
  useEffect(() => {
    update();
  }, [id]);
  return value;
};

export const useExtractedRejection = ({ id }: RejectionInput) => {
  const [value, setValue] = useState("");
  const { reject = undefined } = Promise;
  const run = useCallback(async () => {
    try {
      await reject(id);
    } catch {
      return;
    }
    setValue(id);
  }, [id]);
  useEffect(() => {
    run();
  }, [id]);
  return value;
};
