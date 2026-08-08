// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 748b1bc397cd7d16cca5b01f8e69a8616db6b9fa4ada78647a23acb004bfa9b5
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useRef, useState } from "react";
import prisma from "../../prisma";
import type { ApiKey, List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";

type JsonSafe<T> = T extends Date
  ? string
  : T extends (infer Item)[]
  ? JsonSafe<Item>[]
  : T extends object
  ? { [Key in keyof T]: JsonSafe<T[Key]> }
  : T;

type ApiKeyRow = Pick<ApiKey, "id" | "active"> & {
  createdAt: string;
};

type Props = {
  user: JsonSafe<User>;
  apiKeys: ApiKeyRow[];
  lists: JsonSafe<List>[];
};

type CreationState = "pending" | "succeeded" | "failed";

type CreationBatch = {
  latestRequestId: number;
  refreshStarted: boolean;
  requests: Map<number, CreationState>;
};

const CREATION_ERROR = "Unable to create API key. Try again.";

function serializeForProps<T>(value: T): JsonSafe<T> {
  return JSON.parse(JSON.stringify(value)) as JsonSafe<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiKey(value: unknown): value is ApiKeyRow {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.active === "boolean" &&
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt))
  );
}

function isApiKeysResponse(value: unknown): value is { apiKeys: ApiKeyRow[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.apiKeys) &&
    value.apiKeys.every(isApiKey)
  );
}

function sortApiKeys(apiKeys: ApiKeyRow[]) {
  return [...apiKeys].sort((first, second) => {
    const createdAtDifference =
      new Date(second.createdAt).getTime() -
      new Date(first.createdAt).getTime();

    return createdAtDifference || first.id.localeCompare(second.id);
  });
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
    props: serializeForProps({
      user,
      apiKeys,
      lists,
    }),
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

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState(props.apiKeys);
  const [creationError, setCreationError] = useState(false);
  const [pendingWorkCount, setPendingWorkCount] = useState(0);
  const activeBatchRef = useRef<CreationBatch | null>(null);
  const latestRefreshRef = useRef(0);
  const latestSettledRequestRef = useRef(0);
  const nextRequestIdRef = useRef(0);
  const { lists } = props;

  const reportOutcome = useCallback((requestId: number, failed: boolean) => {
    if (requestId < latestSettledRequestRef.current) return;

    latestSettledRequestRef.current = requestId;
    setCreationError(failed);
  }, []);

  const refreshApiKeys = useCallback(
    (batch: CreationBatch) => {
      const refreshId = ++latestRefreshRef.current;

      void (async () => {
        try {
          const response = await fetch("/api/apiKeys");
          const json: unknown = await response.json();

          if (!response.ok || !isApiKeysResponse(json)) throw new Error();

          if (refreshId === latestRefreshRef.current) {
            setApiKeys(sortApiKeys(json.apiKeys));
          }

          if (batch.requests.get(batch.latestRequestId) === "succeeded") {
            reportOutcome(batch.latestRequestId, false);
          }
        } catch {
          reportOutcome(batch.latestRequestId, true);
        } finally {
          const successfulRequestCount = Array.from(
            batch.requests.values()
          ).filter((state) => state === "succeeded").length;

          setPendingWorkCount((count) => count - successfulRequestCount);
        }
      })();
    },
    [reportOutcome]
  );

  const refreshBatchWhenReady = useCallback(
    (batch: CreationBatch) => {
      if (
        batch.refreshStarted ||
        Array.from(batch.requests.values()).some((state) => state === "pending")
      ) {
        return;
      }

      if (activeBatchRef.current === batch) {
        activeBatchRef.current = null;
      }

      if (!Array.from(batch.requests.values()).includes("succeeded")) return;

      batch.refreshStarted = true;
      refreshApiKeys(batch);
    },
    [refreshApiKeys]
  );

  const createApiKey = useCallback(() => {
    const requestId = ++nextRequestIdRef.current;
    let batch = activeBatchRef.current;

    if (!batch) {
      batch = {
        latestRequestId: requestId,
        refreshStarted: false,
        requests: new Map(),
      };
      activeBatchRef.current = batch;
    }

    batch.latestRequestId = requestId;
    batch.requests.set(requestId, "pending");
    setPendingWorkCount((count) => count + 1);

    void (async () => {
      try {
        const response = await fetch("/api/apiKeys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });
        await response.json();

        if (!response.ok) throw new Error();

        batch.requests.set(requestId, "succeeded");
        reportOutcome(requestId, false);
      } catch {
        batch.requests.set(requestId, "failed");
        setPendingWorkCount((count) => count - 1);
        reportOutcome(requestId, true);
      } finally {
        refreshBatchWhenReady(batch);
      }
    })();
  }, [refreshBatchWhenReady, reportOutcome]);

  const apiKeyRows = sortApiKeys(apiKeys).map((apiKey) => [
    apiKey.id,
    apiKey.active ? "true" : "false",
    new Date(apiKey.createdAt).toLocaleString("en-US", { timeZone: "UTC" }),
  ]);
  const creationStatus =
    pendingWorkCount === 1
      ? "Creating API key…"
      : pendingWorkCount > 1
      ? `Creating ${pendingWorkCount} API keys…`
      : null;

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
              {creationStatus && (
                <p role="status" aria-live="polite" className="mb-4">
                  {creationStatus}
                </p>
              )}
              {creationError && (
                <p role="alert" className="mb-4">
                  {CREATION_ERROR}
                </p>
              )}
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
