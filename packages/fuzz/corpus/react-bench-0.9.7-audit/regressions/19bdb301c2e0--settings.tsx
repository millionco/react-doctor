// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 19bdb301c2e0eb32bf27f3cea24e25cb0f40fd3ccf562858644dc9617eafc87d
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useRef, useState } from "react";
import prisma from "../../prisma";
import type { ApiKey, List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";

const API_KEY_ERROR = "Unable to create API key. Try again.";

type SerializedApiKey = Pick<ApiKey, "id" | "active"> & {
  createdAt: string;
};

type SerializedUser = Omit<User, "createdAt"> & { createdAt: string };
type SerializedList = Omit<List, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export const getServerSideProps = withSessionSsr<{ user: any }>(
  async function ({ req }) {
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
      props: {
        // Next.js props must not contain Prisma Date instances. JSON
        // serialization also walks every nested date in the existing shape.
        ...JSON.parse(
          JSON.stringify({ user: req.session.user, apiKeys, lists })
        ),
      },
    };
  }
);

interface Props {
  user: SerializedUser;
  apiKeys: SerializedApiKey[];
  lists: SerializedList[];
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

function sortApiKeys(apiKeys: SerializedApiKey[]) {
  return [...apiKeys].sort((a, b) => {
    const createdAtDifference =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

    return createdAtDifference || a.id.localeCompare(b.id);
  });
}

function isSuccessfulResponse(response: Response) {
  if (response.ok === false) return false;

  return typeof response.status !== "number" || response.status < 300;
}

function parseRefreshedApiKeys(json: unknown): SerializedApiKey[] {
  if (!json || typeof json !== "object" || !("apiKeys" in json)) {
    throw new Error("Malformed API-key response");
  }

  const apiKeys = (json as { apiKeys?: unknown }).apiKeys;
  if (!Array.isArray(apiKeys)) {
    throw new Error("Malformed API-key response");
  }

  return apiKeys.map((apiKey) => {
    if (!apiKey || typeof apiKey !== "object") {
      throw new Error("Malformed API key");
    }

    const candidate = apiKey as {
      id?: unknown;
      active?: unknown;
      createdAt?: unknown;
    };

    if (
      typeof candidate.id !== "string" ||
      !candidate.id ||
      typeof candidate.active !== "boolean" ||
      (typeof candidate.createdAt !== "string" &&
        !(candidate.createdAt instanceof Date))
    ) {
      throw new Error("Malformed API key");
    }

    const createdAt = new Date(candidate.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("Malformed API key");
    }

    return {
      id: candidate.id,
      active: candidate.active,
      createdAt: createdAt.toISOString(),
    };
  });
}

type CreationBatch = {
  pending: number;
  successful: boolean;
  latestRequestId: number;
};

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState(() => sortApiKeys(props.apiKeys));
  const [alert, setAlert] = useState<string | null>(null);
  const [pendingWork, setPendingWork] = useState(0);
  const nextRequestId = useRef(0);
  const latestSettledRequestId = useRef(0);
  const currentBatch = useRef<CreationBatch | null>(null);
  const latestRefreshId = useRef(0);
  const pendingWorkRef = useRef(0);
  const { lists } = props;

  const updatePendingWork = useCallback((change: number) => {
    pendingWorkRef.current += change;
    setPendingWork(pendingWorkRef.current);
  }, []);

  const refreshApiKeys = useCallback(
    async (batch: CreationBatch) => {
      const refreshId = ++latestRefreshId.current;
      updatePendingWork(1);

      try {
        const response = await fetch("/api/apiKeys");
        if (!isSuccessfulResponse(response)) throw new Error("Refresh failed");

        const refreshedApiKeys = parseRefreshedApiKeys(await response.json());

        // A newer refresh is authoritative even when it resolves first.
        if (refreshId === latestRefreshId.current) {
          setApiKeys(sortApiKeys(refreshedApiKeys));
        }
      } catch {
        // An older refresh must not replace the outcome of a newer request.
        if (batch.latestRequestId >= latestSettledRequestId.current) {
          setAlert(API_KEY_ERROR);
        }
      } finally {
        updatePendingWork(-1);
      }
    },
    [updatePendingWork]
  );

  const settleBatch = useCallback(
    (batch: CreationBatch) => {
      batch.pending -= 1;
      if (batch.pending !== 0) return;

      if (currentBatch.current === batch) currentBatch.current = null;
      if (batch.successful) void refreshApiKeys(batch);
    },
    [refreshApiKeys]
  );

  const createApiKey = useCallback(async () => {
    const requestId = ++nextRequestId.current;
    const batch =
      currentBatch.current && currentBatch.current.pending > 0
        ? currentBatch.current
        : {
            pending: 0,
            successful: false,
            latestRequestId: requestId,
          };

    if (currentBatch.current !== batch) currentBatch.current = batch;
    batch.pending += 1;
    batch.latestRequestId = requestId;
    updatePendingWork(1);

    let successful = false;
    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!isSuccessfulResponse(response)) throw new Error("Creation failed");
      await response.json();
      successful = true;
    } catch {
      successful = false;
    }

    if (successful) batch.successful = true;
    if (requestId > latestSettledRequestId.current) {
      latestSettledRequestId.current = requestId;
      setAlert(successful ? null : API_KEY_ERROR);
    }

    updatePendingWork(-1);
    settleBatch(batch);
  }, [settleBatch, updatePendingWork]);

  const apiKeyRows = apiKeys.map((apiKey) => [
    apiKey.id,
    JSON.stringify(apiKey.active),
    apiKey.createdAt
      ? new Date(apiKey.createdAt).toLocaleString("en-US", {
          timeZone: "UTC",
        })
      : "",
  ]);

  const status =
    pendingWork > 0
      ? pendingWork === 1
        ? "Creating API key…"
        : `Creating ${pendingWork} API keys…`
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
              {status ? (
                <div role="status" aria-live="polite" className="mb-4">
                  {status}
                </div>
              ) : null}
              {alert ? (
                <div role="alert" aria-live="assertive" className="mb-4">
                  {alert}
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
