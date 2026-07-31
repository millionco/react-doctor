/**
 * Rule: no-side-effect-in-state-updater-function
 * Weakness: copy-tracking
 * Source: Bugbot review on PR #1525
 */
import { useState } from "react";

export const FreshPropertyContainer = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { ...previous };
    next.cache = new Map();
    next.cache.set("value", 1);
    return next;
  });
};

export const FreshPropertyAfterSpread = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { ...previous, cache: new Map<string, number>() };
    next.cache.set("value", 1);
    return next;
  });
};

export const FreshPropertyAfterDynamicOverwrite = ({ key }: { key: string }) => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    next[key] = previous.cache;
    next.cache = new Map();
    next.cache.set("value", 1);
    return next;
  });
};

export const FreshDynamicPropertyOverwrite = ({ key }: { key: string }) => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue(() => {
    const next = { cache: new Map<string, number>() };
    next[key] = new Map<string, number>();
    next.cache.set("value", 1);
    return next;
  });
};

export const FreshPropertyAfterObjectAssign = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    Object.assign(next, previous, { cache: new Map<string, number>() });
    next.cache.set("value", 1);
    return next;
  });
};

export const FreshPropertyAfterDefineProperty = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: previous.cache };
    Object.defineProperty(next, "cache", { value: new Map<string, number>() });
    next.cache.set("value", 1);
    return next;
  });
};

export const FreshPropertyThroughHelperParameter = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: previous.cache };
    const freshen = (target: typeof next) =>
      Object.assign(target, { cache: new Map<string, number>() });
    freshen(next);
    next.cache.set("value", 1);
    return next;
  });
};

export const MutationAfterAsyncSuspension = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    const overwrite = async () => {
      await Promise.resolve();
      Object.assign(next, previous);
    };
    void overwrite();
    next.cache.set("value", 1);
    return next;
  });
};

export const UnexecutedGeneratorMutation = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const next = { cache: new Map<string, number>() };
    const overwrite = function* () {
      Object.assign(next, previous);
    };
    overwrite();
    next.cache.set("value", 1);
    return next;
  });
};
