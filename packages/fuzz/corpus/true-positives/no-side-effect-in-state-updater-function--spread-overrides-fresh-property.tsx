// rule: no-side-effect-in-state-updater-function
// weakness: copy-tracking
// source: Cursor Bugbot PR #1525
// verdict: fail

import { useState } from "react";

export const SpreadOverridesFreshProperty = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>(), ...previous };
    next.cache.set("value", 1);
    return next;
  });
  return null;
};

export const DynamicPropertyOverridesFreshProperty = ({ key }: { key: string }) => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    next[key] = previous.cache;
    next.cache.set("value", 1);
    return next;
  });
  return null;
};

export const ObjectAssignOverridesFreshProperty = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    Object.assign(next, previous);
    next.cache.set("value", 1);
    return next;
  });
  return null;
};

export const DefinePropertyOverridesFreshProperty = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    Object.defineProperty(next, "cache", { value: previous.cache });
    next.cache.set("value", 1);
    return next;
  });
  return null;
};

export const HelperParameterOverridesFreshProperty = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    const overwrite = (target: typeof next) => Object.assign(target, previous);
    overwrite(next);
    next.cache.set("value", 1);
    return next;
  });
  return null;
};

export const AsyncPrefixOverridesFreshProperty = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    const overwrite = async () => {
      Object.assign(next, previous);
      await Promise.resolve();
    };
    void overwrite();
    next.cache.set("value", 1);
    return next;
  });
  return null;
};
