// rule: no-effect-wrapper-discards-callback-cleanup-return
// weakness: return-flow
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";
import type { DependencyList, EffectCallback } from "react";

export const useWrapped = (effect: EffectCallback, dependencies: DependencyList): void => {
  useEffect(() => {
    return void effect();
  }, dependencies);
};
