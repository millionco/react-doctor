// rule: no-fetch-response-used-without-status-check
// file-path: packages/cli/src/pages/settings.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 638c4a3d65a6eda027eb2dd0fe02e5ea6d8cc1d02e89dab57fe51eb654a66c2e
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useMemo, useRef, useState } from "react";
import prisma from "../../prisma";
import type { List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";

type SerializedApiKey = {
  id: string;
  active: boolean;
  createdAt: string;
};
type SerializedList = Omit<List, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
type SerializedUser = Omit<User, "createdAt"> & { createdAt: string };

interface Props extends Record<string, unknown> {
  user: SerializedUser;
  apiKeys: SerializedApiKey[];
  lists: SerializedList[];
}

export const getServerSideProps = withSessionSsr<Props>(async function ({
  req,
}) {
  const user = req.session.user;

  if (!user) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }

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
    props: JSON.parse(
      JSON.stringify({
        user: req.session.user,
        apiKeys,
        lists,
      })
    ),
  };
});

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

const API_KEY_ERROR = "Unable to create API key. Try again.";

type ApiKeyForTable = {
  id: string;
  active: boolean;
  createdAt: string;
};

type CreationBatch = {
  pending: number;
  successfulRequestIds: number[];
  newestRequestId: number;
};

function compareApiKeys(a: ApiKeyForTable, b: ApiKeyForTable) {
  const aCreatedAt = new Date(a.createdAt).getTime();
  const bCreatedAt = new Date(b.createdAt).getTime();

  if (aCreatedAt !== bCreatedAt) return bCreatedAt - aCreatedAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRefreshedApiKeys(value: unknown): ApiKeyForTable[] | null {
  if (!isRecord(value) || !Array.isArray(value.apiKeys)) return null;

  const apiKeys: ApiKeyForTable[] = [];

  for (const entry of value.apiKeys) {
    if (!isRecord(entry)) return null;
    if (typeof entry.id !== "string" || entry.id.length === 0) return null;
    if (typeof entry.active !== "boolean") return null;
    if (typeof entry.createdAt !== "string") return null;

    const createdAt = new Date(entry.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;

    apiKeys.push({
      id: entry.id,
      active: entry.active,
      createdAt: createdAt.toISOString(),
    });
  }

  return apiKeys.sort(compareApiKeys);
}

function isSuccessfulResponse(response: Response) {
  if (response.ok === true) return true;
  if (response.ok === false) return false;

  return (
    typeof response.status !== "number" ||
    (response.status >= 200 && response.status < 300)
  );
}

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState(props.apiKeys);
  const [pendingCount, setPendingCount] = useState(0);
  const [hasError, setHasError] = useState(false);
  const { lists } = props;

  const nextRequestId = useRef(0);
  const currentBatch = useRef<CreationBatch | null>(null);
  const activeRequestIds = useRef(new Set<number>());
  const latestSettledRequestId = useRef(0);
  const nextRefreshId = useRef(0);

  const setRequestActive = useCallback((requestId: number, active: boolean) => {
    if (active) activeRequestIds.current.add(requestId);
    else activeRequestIds.current.delete(requestId);

    setPendingCount(activeRequestIds.current.size);
  }, []);

  const setRequestOutcome = useCallback(
    (requestId: number, success: boolean) => {
      if (requestId < latestSettledRequestId.current) return;

      latestSettledRequestId.current = requestId;
      setHasError(!success);
    },
    []
  );

  const refreshApiKeys = useCallback(
    async (batch: CreationBatch) => {
      const refreshId = ++nextRefreshId.current;

      try {
        const response = await fetch("/api/apiKeys");
        if (!isSuccessfulResponse(response)) throw new Error("Refresh failed");

        const json = await response.json();
        const refreshedApiKeys = parseRefreshedApiKeys(json);
        if (!refreshedApiKeys) throw new Error("Malformed API keys");

        if (refreshId === nextRefreshId.current) {
          setApiKeys(refreshedApiKeys);
        }
      } catch {
        setRequestOutcome(batch.newestRequestId, false);
      } finally {
        for (const requestId of batch.successfulRequestIds) {
          setRequestActive(requestId, false);
        }
      }
    },
    [setRequestActive, setRequestOutcome]
  );

  const createApiKey = useCallback(async () => {
    const requestId = ++nextRequestId.current;
    let batch = currentBatch.current;

    if (!batch) {
      batch = {
        pending: 0,
        successfulRequestIds: [],
        newestRequestId: requestId,
      };
      currentBatch.current = batch;
    }

    batch.pending += 1;
    batch.newestRequestId = requestId;
    setRequestActive(requestId, true);

    let success = false;

    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!isSuccessfulResponse(response)) throw new Error("Creation failed");

      // The creation response must be valid JSON, but the GET response remains
      // authoritative for the table contents.
      await response.json();
      success = true;
    } catch {
      setRequestActive(requestId, false);
    }

    setRequestOutcome(requestId, success);

    if (success) batch.successfulRequestIds.push(requestId);
    batch.pending -= 1;

    if (batch.pending === 0) {
      if (currentBatch.current === batch) currentBatch.current = null;

      if (batch.successfulRequestIds.length > 0) {
        void refreshApiKeys(batch);
      }
    }
  }, [refreshApiKeys, setRequestActive, setRequestOutcome]);

  const apiKeyRows = useMemo(
    () =>
      [...apiKeys].sort(compareApiKeys).map((apiKey) => [
        apiKey.id,
        JSON.stringify(apiKey.active),
        apiKey.createdAt
          ? new Date(apiKey.createdAt).toLocaleString("en-US", {
              timeZone: "UTC",
            })
          : "",
      ]),
    [apiKeys]
  );

  const pendingStatus =
    pendingCount === 0
      ? null
      : pendingCount === 1
      ? "Creating API key…"
      : `Creating ${pendingCount} API keys…`;

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
              {pendingStatus ? (
                <div role="status" aria-live="polite" className="mb-4">
                  {pendingStatus}
                </div>
              ) : null}
              {hasError ? (
                <div role="alert" aria-live="assertive" className="mb-4">
                  {API_KEY_ERROR}
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
