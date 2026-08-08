// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 8f4c45c7cc7d5ed7cab457200918a21e9ee9880a3333b0acf59c43c4c35eb0df
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useMemo, useRef, useState } from "react";
import prisma from "../../prisma";
import type { List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";

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
      props: JSON.parse(
        JSON.stringify({
          user: req.session.user,
          apiKeys,
          lists,
        })
      ),
    };
  }
);

interface Props {
  user: Jsonified<User>;
  apiKeys: SerializedApiKey[];
  lists: Jsonified<List>[];
}

type Jsonified<T> = T extends Date
  ? string
  : T extends (infer Item)[]
  ? Jsonified<Item>[]
  : T extends object
  ? { [Key in keyof T]: Jsonified<T[Key]> }
  : T;

type SerializedApiKey = {
  id: string;
  active: boolean;
  createdAt: string;
};

type CreationBatch = {
  pendingRequestIds: Set<number>;
  successfulRequestIds: number[];
};

const CREATION_ERROR = "Unable to create API key. Try again.";

function isApiKey(value: unknown): value is SerializedApiKey {
  if (!value || typeof value !== "object") return false;

  const apiKey = value as Record<string, unknown>;
  if (
    typeof apiKey.id !== "string" ||
    typeof apiKey.active !== "boolean" ||
    typeof apiKey.createdAt !== "string"
  ) {
    return false;
  }

  const date = new Date(apiKey.createdAt);
  return !Number.isNaN(date.getTime());
}

function isApiKeyList(
  value: unknown
): value is { apiKeys: SerializedApiKey[] } {
  if (!value || typeof value !== "object") return false;
  const apiKeys = (value as Record<string, unknown>).apiKeys;
  return Array.isArray(apiKeys) && apiKeys.every(isApiKey);
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

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState(props.apiKeys);
  const [pendingWork, setPendingWork] = useState(0);
  const [creationError, setCreationError] = useState<string | null>(null);
  const nextRequestId = useRef(0);
  const newestSettledRequestId = useRef(0);
  const latestRefreshId = useRef(0);
  const currentBatch = useRef<CreationBatch | null>(null);
  const { lists } = props;

  const setRequestOutcome = useCallback((requestId: number, error: boolean) => {
    if (requestId >= newestSettledRequestId.current) {
      newestSettledRequestId.current = requestId;
      setCreationError(error ? CREATION_ERROR : null);
    }
  }, []);

  const refreshApiKeys = useCallback(
    async (requestIds: number[]) => {
      const refreshId = ++latestRefreshId.current;
      const newestRequestId = Math.max(...requestIds);

      try {
        const response = await fetch("/api/apiKeys", {
          headers: { Accept: "application/json" },
        });
        const json: unknown = await response.json();

        if (!response.ok || !isApiKeyList(json)) throw new Error();

        if (refreshId === latestRefreshId.current) {
          setApiKeys(json.apiKeys);
        }
      } catch {
        setRequestOutcome(newestRequestId, true);
      } finally {
        setPendingWork((count) => count - requestIds.length);
      }
    },
    [setRequestOutcome]
  );

  const finishCreation = useCallback(
    (batch: CreationBatch, requestId: number, successful: boolean) => {
      batch.pendingRequestIds.delete(requestId);

      if (successful) {
        batch.successfulRequestIds.push(requestId);
      } else {
        setPendingWork((count) => count - 1);
      }

      if (batch.pendingRequestIds.size > 0) return;

      if (currentBatch.current === batch) currentBatch.current = null;
      if (batch.successfulRequestIds.length > 0) {
        void refreshApiKeys(batch.successfulRequestIds);
      }
    },
    [refreshApiKeys]
  );

  const createApiKey = useCallback(async () => {
    const requestId = ++nextRequestId.current;
    let batch = currentBatch.current;
    if (!batch) {
      batch = { pendingRequestIds: new Set(), successfulRequestIds: [] };
      currentBatch.current = batch;
    }
    batch.pendingRequestIds.add(requestId);
    setPendingWork((count) => count + 1);

    let successful = false;
    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      await response.json();
      successful = response.ok;
    } catch {
      successful = false;
    }

    setRequestOutcome(requestId, !successful);
    finishCreation(batch, requestId, successful);
  }, [finishCreation, setRequestOutcome]);

  const apiKeyRows = useMemo(
    () =>
      [...apiKeys]
        .sort((a, b) => {
          const byDate =
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (byDate) return byDate;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        })
        .map((apiKey) => [
          apiKey.id,
          JSON.stringify(apiKey.active),
          new Date(apiKey.createdAt).toLocaleString("en-US", {
            timeZone: "UTC",
          }),
        ]),
    [apiKeys]
  );

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
              <div id="api-keys" className="col-span-3">
                {pendingWork > 0 && (
                  <p role="status" aria-live="polite">
                    {pendingWork === 1
                      ? "Creating API key…"
                      : `Creating ${pendingWork} API keys…`}
                  </p>
                )}
                {creationError && <p role="alert">{creationError}</p>}
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
