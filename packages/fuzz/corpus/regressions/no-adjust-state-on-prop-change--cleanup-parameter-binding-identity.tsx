// rule: no-adjust-state-on-prop-change
// weakness: alias-guard
// related-weaknesses: default-parameter, name-heuristic
// source: PR #2308 independent adversarial review
// verdict: pass
import { useEffect, useState, useRef } from "react";

const CleanupMutableLambda = ({ itemId, cache }) => {
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    setSelection(null);
    cache.get(itemId);
    let cleanup = () => {};
    cleanup = () => {
      cancelled = true;
    };
    return cleanup;
  }, [itemId, cache]);
  return selection;
};

const CleanupMutableSubscribe = ({ itemId, cache }) => {
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    setSelection(null);
    cache.get(itemId);
    let cleanup = () => {};
    cleanup = subscribe();
    return cleanup;
  }, [itemId, cache]);
  return selection;
};

const CleanupDefaultParameter = ({ itemId, cache }) => {
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    setSelection(null);
    cache.get(itemId);
    return (value = unsubscribe()) => {};
  }, [itemId, cache]);
  return selection;
};

const CleanupDestructuringDefault = ({ itemId, cache }) => {
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    setSelection(null);
    cache.get(itemId);
    return ({ value = unsubscribe() } = {}) => {};
  }, [itemId, cache]);
  return selection;
};

const CleanupNamedNoopTernary = ({ itemId, cache }) => {
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    setSelection(null);
    cache.get(itemId);
    const noop = () => {};
    return isEnabled ? subscribe() : noop;
  }, [itemId, cache]);
  return selection;
};

const CleanupFakeUsecallbackFactory = ({ itemId, cache }) => {
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    setSelection(null);
    cache.get(itemId);
    const api = {
      useCallback: (_callback) => () => {
        cancelled = true;
      },
    };
    const cleanup = api.useCallback(() => {});
    return cleanup;
  }, [itemId, cache]);
  return selection;
};
