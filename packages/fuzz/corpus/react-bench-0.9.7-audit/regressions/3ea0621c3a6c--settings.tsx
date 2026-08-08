// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 3ea0621c3a6ca7cc3ef449c0a5648393012e808428082f74483cbd2830ca6859
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useEffect, useRef, useState } from "react";
import prisma from "../../prisma";
import type { List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";

const ALERT_TEXT = "Unable to create API key. Try again.";

/**
 * Serialize every Date value to an ISO string while preserving the existing
 * shape and all non-date values. The result is JSON-safe so it can be returned
 * directly from getServerSideProps.
 */
function serializeDates<T>(value: T): T {
  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(serializeDates) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = serializeDates(
        (value as Record<string, unknown>)[key]
      );
    }
    return out as unknown as T;
  }
  return value;
}

type ApiKeyRow = {
  id: string;
  active: boolean;
  createdAt: string; // ISO string
};

/**
 * Sort newest-first by createdAt, then by id ascending.
 */
function sortApiKeys(rows: ApiKeyRow[]): ApiKeyRow[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
    if (tb !== ta) return tb - ta;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

function isValidApiKeyRow(row: unknown): row is ApiKeyRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.active === "boolean" &&
    typeof r.createdAt === "string" &&
    !Number.isNaN(new Date(r.createdAt).getTime())
  );
}

function normalizeApiKeyRow(row: unknown): ApiKeyRow {
  const r = row as Record<string, any>;
  return {
    id: r.id,
    active: r.active,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

export const getServerSideProps = withSessionSsr<{
  user: User;
  apiKeys: ApiKeyRow[];
  lists: List[];
}>(async function ({ req }) {
  const user = req.session.user;

  if (!user) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }

  // Start the independent API-key and list reads together.
  const [apiKeys, lists] = await Promise.all([
    prisma.apiKey.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, active: true, createdAt: true },
    }),
    prisma.list.findMany({
      where: { organizationId: user.organizationId },
    }),
  ]);

  return {
    props: {
      user: serializeDates(req.session.user),
      apiKeys: serializeDates(apiKeys),
      lists: serializeDates(lists),
    },
  };
});

interface Props {
  user: User;
  apiKeys: ApiKeyRow[];
  lists: List[];
}

const API_TABLE_HEADERS: (ReactElement | string)[] = [
  "API Key",
  "Active",
  "Date created",
];
const LIST_TABLE_HEADERS: (ReactElement | string)[] = [
  "Name",
  "Display name",
  "",
];

type Phase = "creating" | "refreshing" | "done";
type Outcome = "success" | "failure";

type RequestRecord = {
  phase: Phase;
  outcome: Outcome | null;
};

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>(() =>
    sortApiKeys(props.apiKeys)
  );
  const [alertText, setAlertText] = useState<string | null>(null);
  const [statusCount, setStatusCount] = useState(0);
  const { lists } = props;

  // Mutable tracking of in-flight work. Refs are used so that overlapping
  // requests never read stale state through a captured closure.
  const nextRequestIdRef = useRef(1);
  const requestsRef = useRef(new Map<number, RequestRecord>());
  const pendingCreateIdsRef = useRef(new Set<number>());
  const refreshNeededIdsRef = useRef(new Set<number>());
  const nextRefreshIdRef = useRef(1);
  const newestRefreshIdRef = useRef(0);
  const settledOutcomesRef = useRef(new Map<number, Outcome>());
  const lastSettledIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncUi = useCallback(() => {
    if (!mountedRef.current) return;

    let count = 0;
    for (const rec of requestsRef.current.values()) {
      if (rec.phase !== "done") count++;
    }
    setStatusCount(count);

    let alert: string | null = null;
    if (lastSettledIdRef.current > 0) {
      const outcome = settledOutcomesRef.current.get(
        lastSettledIdRef.current
      );
      // A successful newest request clears the alert without a success message.
      if (outcome === "failure") {
        alert = ALERT_TEXT;
      }
    }
    setAlertText(alert);
  }, []);

  const startRefresh = useCallback(
    (batchIds: number[]) => {
      const refreshId = nextRefreshIdRef.current++;
      newestRefreshIdRef.current = refreshId;

      void (async () => {
        let refreshOk = false;
        let rows: ApiKeyRow[] | null = null;
        try {
          const response = await fetch("/api/apiKeys", { method: "GET" });
          const data = await response.json();
          if (
            response.ok &&
            data &&
            Array.isArray(data.apiKeys) &&
            data.apiKeys.every(isValidApiKeyRow)
          ) {
            rows = data.apiKeys.map(normalizeApiKeyRow);
            refreshOk = true;
          }
        } catch {
          refreshOk = false;
        }

        for (const id of batchIds) {
          const rec = requestsRef.current.get(id);
          if (rec) {
            rec.phase = "done";
            rec.outcome = refreshOk ? "success" : "failure";
            settledOutcomesRef.current.set(id, rec.outcome);
            if (id > lastSettledIdRef.current) {
              lastSettledIdRef.current = id;
            }
          }
        }

        // The refreshed response replaces the previous rows. Only the newest
        // refresh's authoritative result is allowed to update the table so a
        // newer result remains visible even if an earlier refresh settles
        // afterward.
        if (
          refreshOk &&
          rows &&
          refreshId === newestRefreshIdRef.current &&
          mountedRef.current
        ) {
          setApiKeys(sortApiKeys(rows));
        }

        syncUi();
      })();
    },
    [syncUi]
  );

  const createApiKey = useCallback(async () => {
    const requestId = nextRequestIdRef.current++;
    requestsRef.current.set(requestId, { phase: "creating", outcome: null });
    pendingCreateIdsRef.current.add(requestId);
    syncUi();

    let createOk = false;
    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      // Parse to surface invalid JSON as a failure.
      await response.json();
      if (response.ok) {
        createOk = true;
      }
    } catch {
      createOk = false;
    }

    pendingCreateIdsRef.current.delete(requestId);
    const rec = requestsRef.current.get(requestId);
    if (!rec) {
      syncUi();
      return;
    }

    if (createOk) {
      rec.phase = "refreshing";
      refreshNeededIdsRef.current.add(requestId);
    } else {
      rec.phase = "done";
      rec.outcome = "failure";
      settledOutcomesRef.current.set(requestId, "failure");
      if (requestId > lastSettledIdRef.current) {
        lastSettledIdRef.current = requestId;
      }
    }

    // Overlapping successes produce one refresh after every request in that
    // batch settles. A later batch that settles while an earlier refresh is
    // still pending starts its own refresh immediately.
    if (
      pendingCreateIdsRef.current.size === 0 &&
      refreshNeededIdsRef.current.size > 0
    ) {
      const batchIds = Array.from(refreshNeededIdsRef.current);
      refreshNeededIdsRef.current.clear();
      startRefresh(batchIds);
    }

    syncUi();
  }, [syncUi, startRefresh]);

  const apiKeyRows: (string | ReactElement)[][] = apiKeys.map((apiKey) => [
    apiKey.id,
    JSON.stringify(apiKey.active),
    apiKey.createdAt
      ? new Date(apiKey.createdAt).toLocaleString("en-US", {
          timeZone: "UTC",
        })
      : "",
  ]);

  const statusMessage =
    statusCount === 0
      ? null
      : statusCount === 1
      ? "Creating API key…"
      : `Creating ${statusCount} API keys…`;

  return (
    <>
      <div>
        <div className="w-full">
          <main className="py-16">
            <div className="px-8 max-w-2xl mx-auto">
              <h1 className="font-bold text-3xl mt-0 mb-8">Account</h1>
              <p className="block leading-none text-sm font-bold text-slate-400 mb-3">
                Email
              </p>
              {props.user?.email}
            </div>
            <hr className="my-16 border-dotted border-gray-500 border-top border-bottom-0" />
            <div className="px-8 max-w-2xl mx-auto ">
              <div className="mt-16 col-span-3" />
              <div className="flex mb-8">
                <h2 className="grow inline-flex text-3xl font-bold">
                  API Keys
                </h2>
                <div className="inline-flex text-right">
                  <OutlineButton
                    onClick={createApiKey}
                    small
                    text="New API Key"
                  />
                </div>
              </div>
              {alertText ? (
                <div
                  role="alert"
                  className="mb-4 bg-red-400 text-black rounded-md py-2 px-3 api-key-error"
                >
                  {alertText}
                </div>
              ) : null}
              {statusMessage ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-4 text-slate-300 api-key-status"
                >
                  {statusMessage}
                </div>
              ) : null}
              <div id="api-keys" className="col-span-3">
                <Table rows={[API_TABLE_HEADERS].concat(apiKeyRows)} />
              </div>
            </div>
            <hr className="my-16 border-dotted border-gray-500 border-top border-bottom-0" />
            <div className="px-8 max-w-2xl mx-auto">
              <div className="flex mb-8">
                <h2 className="grow inline-flex text-3xl font-bold">Lists</h2>
              </div>
              <div className="col-span-3">
                <Table
                  rows={[LIST_TABLE_HEADERS].concat(
                    lists.map((list) => [
                      list.name,
                      list.displayName,
                      <Link
                        key={list.id}
                        href={`/lists/${list.id}/subscribe`}
                        legacyBehavior
                      >
                        <a>Subscribe</a>
                      </Link>,
                    ])
                  )}
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default Settings;
