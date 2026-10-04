// rule: no-fetch-response-used-without-status-check
// file-path: packages/cli/src/pages/settings.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit b7b91aa397afd52cd4d24811c91a57501e9b275787a85ce167070a785c37ba65
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useMemo, useRef, useState } from "react";
import prisma from "../../prisma";
import type { ApiKey, List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";

type SerializedDates<T> = T extends Date
  ? string
  : T extends Array<infer U>
  ? SerializedDates<U>[]
  : T extends object
  ? { [K in keyof T]: SerializedDates<T[K]> }
  : T;

export function serializeDates<T>(value: T): SerializedDates<T> {
  if (value instanceof Date) {
    return value.toISOString() as SerializedDates<T>;
  }

  if (Array.isArray(value)) {
    return value.map(serializeDates) as SerializedDates<T>;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, serializeDates(child)])
    ) as SerializedDates<T>;
  }

  return value as SerializedDates<T>;
}

export const getServerSideProps = withSessionSsr(async function ({ req }) {
  const user = req.session.user;

  if (!user) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }

  const apiKeysPromise = prisma.apiKey.findMany({
    where: { organizationId: user.organizationId },
    select: { id: true, active: true, createdAt: true },
  });

  const listsPromise = prisma.list.findMany({
    where: { organizationId: user.organizationId },
  });

  const [apiKeys, lists] = await Promise.all([apiKeysPromise, listsPromise]);

  return {
    props: serializeDates({ user, apiKeys, lists }),
  };
});

interface Props {
  user: SerializedDates<User>;
  apiKeys: SerializedDates<Pick<ApiKey, "id" | "active" | "createdAt">>[];
  lists: SerializedDates<List>[];
}

type SerializedApiKey = Props["apiKeys"][number];

type CreationBatch = {
  pending: number;
  successfulRequestIds: number[];
};

const CREATION_ERROR = "Unable to create API key. Try again.";

function isSerializedApiKey(value: unknown): value is SerializedApiKey {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const apiKey = value as Record<string, unknown>;
  if (
    typeof apiKey.id !== "string" ||
    apiKey.id.length === 0 ||
    typeof apiKey.active !== "boolean" ||
    typeof apiKey.createdAt !== "string"
  ) {
    return false;
  }

  const createdAt = new Date(apiKey.createdAt);
  return (
    !Number.isNaN(createdAt.getTime()) &&
    createdAt.toISOString() === apiKey.createdAt
  );
}

function apiKeysFromResponse(value: unknown): SerializedApiKey[] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const apiKeys = (value as Record<string, unknown>).apiKeys;
  return Array.isArray(apiKeys) && apiKeys.every(isSerializedApiKey)
    ? apiKeys
    : null;
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
  const [creationError, setCreationError] = useState(false);
  const [outstandingCreations, setOutstandingCreations] = useState(0);
  const nextRequestId = useRef(0);
  const newestSettledRequestId = useRef(0);
  const newestRefreshId = useRef(0);
  const creationBatch = useRef<CreationBatch | null>(null);
  const { lists } = props;

  const apiKeyRows = useMemo(
    () =>
      [...apiKeys]
        .sort((left, right) => {
          const dateDifference =
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime();

          if (dateDifference !== 0) return dateDifference;
          if (left.id < right.id) return -1;
          if (left.id > right.id) return 1;
          return 0;
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

  const refreshApiKeys = useCallback(async (successfulRequestIds: number[]) => {
    const refreshId = ++newestRefreshId.current;
    const newestRequestId = Math.max(...successfulRequestIds);

    try {
      const response = await fetch("/api/apiKeys");
      const json: unknown = await response.json();
      const refreshedApiKeys = apiKeysFromResponse(json);

      if (!response.ok || refreshedApiKeys === null) {
        throw new Error("Unable to refresh API keys");
      }

      if (refreshId === newestRefreshId.current) {
        setApiKeys(refreshedApiKeys);
      }
    } catch {
      if (newestRequestId >= newestSettledRequestId.current) {
        setCreationError(true);
      }
    } finally {
      setOutstandingCreations((count) => count - successfulRequestIds.length);
    }
  }, []);

  const createApiKey = useCallback(async () => {
    const requestId = ++nextRequestId.current;
    let batch = creationBatch.current;

    if (batch === null) {
      batch = { pending: 0, successfulRequestIds: [] };
      creationBatch.current = batch;
    }

    batch.pending += 1;
    setOutstandingCreations((count) => count + 1);

    let succeeded = false;
    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      await response.json();
      if (!response.ok) throw new Error("Unable to create API key");
      succeeded = true;
    } catch {
      succeeded = false;
    }

    if (requestId > newestSettledRequestId.current) {
      newestSettledRequestId.current = requestId;
      setCreationError(!succeeded);
    }

    batch.pending -= 1;
    if (succeeded) {
      batch.successfulRequestIds.push(requestId);
    } else {
      setOutstandingCreations((count) => count - 1);
    }

    if (batch.pending === 0) {
      creationBatch.current = null;
      if (batch.successfulRequestIds.length > 0) {
        void refreshApiKeys(batch.successfulRequestIds);
      }
    }
  }, [refreshApiKeys]);

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
                {outstandingCreations > 0 && (
                  <p role="status" aria-live="polite">
                    {outstandingCreations === 1
                      ? "Creating API key…"
                      : `Creating ${outstandingCreations} API keys…`}
                  </p>
                )}
                {creationError && <p role="alert">{CREATION_ERROR}</p>}
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
