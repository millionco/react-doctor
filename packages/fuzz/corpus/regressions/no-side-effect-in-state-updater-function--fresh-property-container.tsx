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
