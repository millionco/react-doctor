// rule: no-fetch-response-used-without-status-check
// file-path: packages/cli/src/util/useApiKeyCreation.ts
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit e0b7f506fe1588ab00599019a67aaa2d822fe76fea1a02d1f96910faeaaa5cec
import { useCallback, useRef, useState } from "react";
import {
  API_KEY_CREATE_ERROR,
  ApiKeyRow,
  creatingStatusText,
  isValidApiKeyRow,
  sortApiKeys,
} from "./apiKeysUi";

type UseApiKeyCreationResult = {
  apiKeys: ApiKeyRow[];
  error: string | null;
  statusText: string | null;
  createApiKey: () => Promise<void>;
};

export function useApiKeyCreation(
  initialApiKeys: ApiKeyRow[]
): UseApiKeyCreationResult {
  const [apiKeys, setApiKeys] = useState(() => sortApiKeys(initialApiKeys));
  const [error, setError] = useState<string | null>(null);
  const [statusCount, setStatusCount] = useState(0);

  const nextRequestIdRef = useRef(0);
  const newestSettledRequestIdRef = useRef(0);
  const inFlightCreatesRef = useRef(0);
  const batchSizeRef = useRef(0);
  const batchSuccessesRef = useRef(0);
  const batchMaxRequestIdRef = useRef(0);
  const refreshGenerationRef = useRef(0);
  const refreshPendingRef = useRef(false);

  const updateStatusCount = useCallback((count: number) => {
    setStatusCount(count);
  }, []);

  const refreshApiKeys = useCallback(
    async (batchMaxRequestId: number, batchSize: number) => {
      const generation = ++refreshGenerationRef.current;
      refreshPendingRef.current = true;
      updateStatusCount(batchSize);

      try {
        const response = await fetch("/api/apiKeys", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error("unsuccessful refresh");
        }

        const json = await response.json();

        if (
          !json ||
          !Array.isArray(json.apiKeys) ||
          !json.apiKeys.every(isValidApiKeyRow)
        ) {
          throw new Error("malformed api keys");
        }

        // A newer refresh was started; keep waiting for its authoritative result.
        if (generation !== refreshGenerationRef.current) {
          return;
        }

        setApiKeys(sortApiKeys(json.apiKeys));

        if (batchMaxRequestId >= newestSettledRequestIdRef.current) {
          setError(null);
        }
      } catch {
        if (batchMaxRequestId >= newestSettledRequestIdRef.current) {
          setError(API_KEY_CREATE_ERROR);
        }
      } finally {
        if (generation === refreshGenerationRef.current) {
          refreshPendingRef.current = false;
          if (inFlightCreatesRef.current === 0) {
            updateStatusCount(0);
          }
        }
      }
    },
    [updateStatusCount]
  );

  const createApiKey = useCallback(async () => {
    const requestId = ++nextRequestIdRef.current;
    inFlightCreatesRef.current += 1;
    batchSizeRef.current += 1;
    batchMaxRequestIdRef.current = Math.max(
      batchMaxRequestIdRef.current,
      requestId
    );
    updateStatusCount(inFlightCreatesRef.current);

    let success = false;

    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Invalid JSON must leave the table unchanged and surface the alert.
      await response.json();

      if (!response.ok) {
        throw new Error("unsuccessful create");
      }

      success = true;
    } catch {
      success = false;
    }

    if (requestId >= newestSettledRequestIdRef.current) {
      newestSettledRequestIdRef.current = requestId;
      if (success) {
        setError(null);
      } else {
        setError(API_KEY_CREATE_ERROR);
      }
    }

    if (success) {
      batchSuccessesRef.current += 1;
    }

    inFlightCreatesRef.current -= 1;

    if (inFlightCreatesRef.current === 0) {
      const batchSize = batchSizeRef.current;
      const batchSuccesses = batchSuccessesRef.current;
      const batchMaxRequestId = batchMaxRequestIdRef.current;

      batchSizeRef.current = 0;
      batchSuccessesRef.current = 0;
      batchMaxRequestIdRef.current = 0;

      if (batchSuccesses > 0) {
        // One refresh after every request in the overlapping batch settles.
        // Later successful batches start a new refresh immediately.
        void refreshApiKeys(batchMaxRequestId, batchSize);
      } else if (!refreshPendingRef.current) {
        updateStatusCount(0);
      }
    } else {
      updateStatusCount(inFlightCreatesRef.current);
    }
  }, [refreshApiKeys, updateStatusCount]);

  return {
    apiKeys,
    error,
    statusText: statusCount > 0 ? creatingStatusText(statusCount) : null,
    createApiKey,
  };
}
