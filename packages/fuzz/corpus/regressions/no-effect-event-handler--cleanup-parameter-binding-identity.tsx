// rule: no-effect-event-handler
// weakness: alias-guard
// related-weaknesses: default-parameter, name-heuristic
// source: PR #2308 independent adversarial review
// verdict: pass
import { useEffect, useState, useRef } from "react";

const CleanupMutableLambda = ({ status }) => {
  useEffect(() => {
    if (status !== "submitted") return;
    toast("Order submitted!");
    let cleanup = () => {};
    cleanup = () => {
      cancelled = true;
    };
    return cleanup;
  }, [status]);
  return null;
};

const CleanupMutableSubscribe = ({ status }) => {
  useEffect(() => {
    if (status !== "submitted") return;
    toast("Order submitted!");
    let cleanup = () => {};
    cleanup = subscribe();
    return cleanup;
  }, [status]);
  return null;
};

const CleanupDefaultParameter = ({ status }) => {
  useEffect(() => {
    if (status !== "submitted") return;
    toast("Order submitted!");
    return (value = unsubscribe()) => {};
  }, [status]);
  return null;
};

const CleanupDestructuringDefault = ({ status }) => {
  useEffect(() => {
    if (status !== "submitted") return;
    toast("Order submitted!");
    return ({ value = unsubscribe() } = {}) => {};
  }, [status]);
  return null;
};

const CleanupNamedNoopTernary = ({ status }) => {
  useEffect(() => {
    if (status !== "submitted") return;
    toast("Order submitted!");
    const noop = () => {};
    return isEnabled ? subscribe() : noop;
  }, [status]);
  return null;
};

const CleanupFakeUsecallbackFactory = ({ status }) => {
  useEffect(() => {
    if (status !== "submitted") return;
    toast("Order submitted!");
    const api = {
      useCallback: (_callback) => () => {
        cancelled = true;
      },
    };
    const cleanup = api.useCallback(() => {});
    return cleanup;
  }, [status]);
  return null;
};
