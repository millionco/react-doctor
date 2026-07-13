import * as path from "node:path";
import { toCanonicalPath } from "./to-canonical-path.js";

interface RootScanIsolationWaiter {
  isExclusive: boolean;
  resolve: (release: () => void) => void;
}

interface RootScanIsolationState {
  activeSharedCount: number;
  isExclusiveActive: boolean;
  waiters: RootScanIsolationWaiter[];
}

const isolationByRoot = new Map<string, RootScanIsolationState>();

const deleteUnusedIsolationState = (rootKey: string, state: RootScanIsolationState): void => {
  if (state.activeSharedCount > 0 || state.isExclusiveActive || state.waiters.length > 0) return;
  if (isolationByRoot.get(rootKey) === state) isolationByRoot.delete(rootKey);
};

const dispatchIsolationWaiters = (rootKey: string, state: RootScanIsolationState): void => {
  if (state.isExclusiveActive || state.activeSharedCount > 0) return;
  const firstWaiter = state.waiters[0];
  if (!firstWaiter) {
    deleteUnusedIsolationState(rootKey, state);
    return;
  }
  if (firstWaiter.isExclusive) {
    state.waiters.shift();
    state.isExclusiveActive = true;
    firstWaiter.resolve(() => {
      state.isExclusiveActive = false;
      dispatchIsolationWaiters(rootKey, state);
    });
    return;
  }
  while (state.waiters[0] && !state.waiters[0].isExclusive) {
    const waiter = state.waiters.shift();
    if (!waiter) break;
    state.activeSharedCount += 1;
    waiter.resolve(() => {
      state.activeSharedCount -= 1;
      dispatchIsolationWaiters(rootKey, state);
    });
  }
};

const acquireRootScanIsolation = async (
  rootDirectory: string,
  requiresExclusiveAccess: boolean,
): Promise<() => void> => {
  const rootKey = toCanonicalPath(path.resolve(rootDirectory));
  const state = isolationByRoot.get(rootKey) ?? {
    activeSharedCount: 0,
    isExclusiveActive: false,
    waiters: [],
  };
  isolationByRoot.set(rootKey, state);

  const hasWaitingExclusive = state.waiters.some((waiter) => waiter.isExclusive);
  if (!requiresExclusiveAccess && !state.isExclusiveActive && !hasWaitingExclusive) {
    state.activeSharedCount += 1;
    return () => {
      state.activeSharedCount -= 1;
      dispatchIsolationWaiters(rootKey, state);
    };
  }
  if (
    requiresExclusiveAccess &&
    !state.isExclusiveActive &&
    state.activeSharedCount === 0 &&
    state.waiters.length === 0
  ) {
    state.isExclusiveActive = true;
    return () => {
      state.isExclusiveActive = false;
      dispatchIsolationWaiters(rootKey, state);
    };
  }
  return new Promise((resolve) => {
    state.waiters.push({ isExclusive: requiresExclusiveAccess, resolve });
  });
};

export const withRootScanIsolation = async <Result>(
  rootDirectory: string,
  requiresExclusiveAccess: boolean,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const release = await acquireRootScanIsolation(rootDirectory, requiresExclusiveAccess);
  try {
    return await operation();
  } finally {
    release();
  }
};
