// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 4ae3811bba5c518e7a0d299f9938b59467595c5446d9111cb07c8267eab21c88
import { useCallback, useRef, useState } from "react";
import {
  parseApiKeysResponse,
  SettingsApiKey,
  sortApiKeys,
} from "./settingsApiKeys";

const CREATE_ERROR_MESSAGE = "Unable to create API key. Try again.";

export function useSettingsApiKeys(initialApiKeys: SettingsApiKey[]) {
  const [apiKeys, setApiKeys] = useState(() => sortApiKeys(initialApiKeys));
  const [creatingCount, setCreatingCount] = useState(0);
  const [showCreateError, setShowCreateError] = useState(false);

  const postInFlightRef = useRef(0);
  const awaitingRefreshIdsRef = useRef<number[]>([]);
  const requestIdRef = useRef(0);
  const requestOutcomeRef = useRef<Map<number, boolean>>(new Map());
  const refreshGenerationRef = useRef(0);
  const latestAppliedRefreshRef = useRef(0);

  const recomputeAlert = useCallback(() => {
    let maxSettledId = -1;
    let latestSuccess = true;
    for (const [id, success] of requestOutcomeRef.current) {
      if (id > maxSettledId) {
        maxSettledId = id;
        latestSuccess = success;
      }
    }
    setShowCreateError(maxSettledId >= 0 && !latestSuccess);
  }, []);

  const settleRequests = useCallback(
    (ids: number[], success: boolean) => {
      for (const id of ids) {
        requestOutcomeRef.current.set(id, success);
      }
      setCreatingCount((count) => Math.max(0, count - ids.length));
      recomputeAlert();
    },
    [recomputeAlert]
  );

  const refreshApiKeys = useCallback(
    async (requestIds: number[]) => {
      const generation = ++refreshGenerationRef.current;

      try {
        const response = await fetch("/api/apiKeys");
        if (!response.ok) {
          throw new Error("refresh failed");
        }

        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new Error("invalid json");
        }

        const parsed = parseApiKeysResponse(json);
        if (!parsed) {
          throw new Error("malformed api keys");
        }

        if (generation >= latestAppliedRefreshRef.current) {
          latestAppliedRefreshRef.current = generation;
          setApiKeys(parsed);
        }
        settleRequests(requestIds, true);
      } catch {
        settleRequests(requestIds, false);
      }
    },
    [settleRequests]
  );

  const maybeStartRefresh = useCallback(() => {
    if (
      postInFlightRef.current === 0 &&
      awaitingRefreshIdsRef.current.length > 0
    ) {
      const batch = awaitingRefreshIdsRef.current;
      awaitingRefreshIdsRef.current = [];
      void refreshApiKeys(batch);
    }
  }, [refreshApiKeys]);

  const createApiKey = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    postInFlightRef.current += 1;
    setCreatingCount((count) => count + 1);

    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      try {
        await response.json();
      } catch {
        throw new Error("invalid json");
      }

      if (!response.ok) {
        throw new Error("create failed");
      }

      awaitingRefreshIdsRef.current.push(requestId);
    } catch {
      settleRequests([requestId], false);
    } finally {
      postInFlightRef.current -= 1;
      maybeStartRefresh();
    }
  }, [maybeStartRefresh, settleRequests]);

  const creatingStatus =
    creatingCount === 0
      ? null
      : creatingCount === 1
      ? "Creating API key…"
      : `Creating ${creatingCount} API keys…`;

  return {
    apiKeys,
    createApiKey,
    creatingStatus,
    showCreateError,
    createErrorMessage: CREATE_ERROR_MESSAGE,
  };
}
