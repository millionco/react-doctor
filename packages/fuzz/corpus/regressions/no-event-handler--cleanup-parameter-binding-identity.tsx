// rule: no-event-handler
// weakness: alias-guard
// related-weaknesses: default-parameter, name-heuristic
// source: PR #2308 independent adversarial review
// verdict: pass
import { useEffect, useState, useRef } from "react";

const CleanupMutableLambda = ({ onShow }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) setTimeout(() => onShow(), 0);
    let cleanup = () => {};
    cleanup = () => {
      cancelled = true;
    };
    return cleanup;
  }, [visible, onShow]);
  return <button onClick={() => setVisible(true)} />;
};

const CleanupMutableSubscribe = ({ onShow }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) setTimeout(() => onShow(), 0);
    let cleanup = () => {};
    cleanup = subscribe();
    return cleanup;
  }, [visible, onShow]);
  return <button onClick={() => setVisible(true)} />;
};

const CleanupDefaultParameter = ({ onShow }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) setTimeout(() => onShow(), 0);
    return (value = unsubscribe()) => {};
  }, [visible, onShow]);
  return <button onClick={() => setVisible(true)} />;
};

const CleanupDestructuringDefault = ({ onShow }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) setTimeout(() => onShow(), 0);
    return ({ value = unsubscribe() } = {}) => {};
  }, [visible, onShow]);
  return <button onClick={() => setVisible(true)} />;
};

const CleanupNamedNoopTernary = ({ onShow }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) setTimeout(() => onShow(), 0);
    const noop = () => {};
    return isEnabled ? subscribe() : noop;
  }, [visible, onShow]);
  return <button onClick={() => setVisible(true)} />;
};

const CleanupFakeUsecallbackFactory = ({ onShow }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) setTimeout(() => onShow(), 0);
    const api = {
      useCallback: (_callback) => () => {
        cancelled = true;
      },
    };
    const cleanup = api.useCallback(() => {});
    return cleanup;
  }, [visible, onShow]);
  return <button onClick={() => setVisible(true)} />;
};
