// rule: no-pass-data-to-parent
// weakness: alias-guard
// related-weaknesses: default-parameter, name-heuristic
// source: PR #2308 independent adversarial review
// verdict: pass
import { useEffect, useState, useRef } from "react";

export const CleanupMutableLambda = ({ onPendingChange }) => {
  const values = useSelectedValues();
  useEffect(() => {
    onPendingChange(values);
    let cleanup = () => {};
    cleanup = () => {
      cancelled = true;
    };
    return cleanup;
  }, [onPendingChange, values]);
  return null;
};

export const CleanupMutableSubscribe = ({ onPendingChange }) => {
  const values = useSelectedValues();
  useEffect(() => {
    onPendingChange(values);
    let cleanup = () => {};
    cleanup = subscribe();
    return cleanup;
  }, [onPendingChange, values]);
  return null;
};

export const CleanupDefaultParameter = ({ onPendingChange }) => {
  const values = useSelectedValues();
  useEffect(() => {
    onPendingChange(values);
    return (value = unsubscribe()) => {};
  }, [onPendingChange, values]);
  return null;
};

export const CleanupDestructuringDefault = ({ onPendingChange }) => {
  const values = useSelectedValues();
  useEffect(() => {
    onPendingChange(values);
    return ({ value = unsubscribe() } = {}) => {};
  }, [onPendingChange, values]);
  return null;
};

export const CleanupNamedNoopTernary = ({ onPendingChange }) => {
  const values = useSelectedValues();
  useEffect(() => {
    onPendingChange(values);
    const noop = () => {};
    return isEnabled ? subscribe() : noop;
  }, [onPendingChange, values]);
  return null;
};

export const CleanupFakeUsecallbackFactory = ({ onPendingChange }) => {
  const values = useSelectedValues();
  useEffect(() => {
    onPendingChange(values);
    const api = {
      useCallback: (_callback) => () => {
        cancelled = true;
      },
    };
    const cleanup = api.useCallback(() => {});
    return cleanup;
  }, [onPendingChange, values]);
  return null;
};
