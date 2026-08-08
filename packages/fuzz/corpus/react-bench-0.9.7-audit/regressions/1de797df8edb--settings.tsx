// rule: no-loading-flag-reset-outside-finally
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 1de797df8edb80eb05988776db6fdd7ca290e56c0d0b1b27d9688414e501272a
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useEffect, useState, useRef } from "react";
import prisma from "../../prisma";
import type { List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";

interface SerializedApiKey {
  id: string;
  active: boolean;
  createdAt: string;
}

function serializeDates(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeDates);
  }
  if (typeof obj === 'object') {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = serializeDates(obj[key]);
    }
    return res;
  }
  return obj;
}

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
        JSON.stringify(
          serializeDates({
            user: req.session.user,
            apiKeys,
            lists,
          })
        )
      ),
    };
  }
);

interface Props {
  user: User;
  apiKeys: SerializedApiKey[];
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

function isValidApiKey(key: any): boolean {
  if (!key || typeof key !== "object") return false;
  if (typeof key.id !== "string") return false;
  if (typeof key.active !== "boolean") return false;
  if (!key.createdAt) return false;
  const d = new Date(key.createdAt);
  if (isNaN(d.getTime())) return false;
  return true;
}

function sortApiKeys(keys: SerializedApiKey[]): SerializedApiKey[] {
  return [...keys].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    if (dateA !== dateB) {
      return dateB - dateA;
    }
    return a.id.localeCompare(b.id);
  });
}

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState<SerializedApiKey[]>(() => sortApiKeys(props.apiKeys));
  const [apiKeyRows, setApiKeyRows] = useState<string[][]>([]);
  const { lists } = props;

  const [alert, setAlert] = useState<string | null>(null);
  const [pendingCreations, setPendingCreations] = useState<number>(0);
  const [refreshPending, setRefreshPending] = useState<boolean>(false);

  const requestCounterRef = useRef(0);
  const maxSettledRequestIdRef = useRef(0);
  const refreshCounterRef = useRef(0);
  const latestStartedRefreshIdRef = useRef(0);
  const refreshingBatchCountRef = useRef(0);

  // Tracks request status: { success, error }
  const activeRequestsRef = useRef<Map<number, { success: boolean; error: boolean }>>(new Map());

  const createApiKey = useCallback(async () => {
    const reqId = ++requestCounterRef.current;
    
    activeRequestsRef.current.set(reqId, { success: false, error: false });
    setPendingCreations((prev) => prev + 1);

    let creationSuccess = false;

    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.status === 201) {
        creationSuccess = true;
      }
    } catch (e) {
      creationSuccess = false;
    }

    const reqState = activeRequestsRef.current.get(reqId);
    if (reqState) {
      reqState.success = creationSuccess;
      reqState.error = !creationSuccess;
    }

    setPendingCreations((prev) => prev - 1);

    if (!creationSuccess) {
      if (reqId >= maxSettledRequestIdRef.current) {
        maxSettledRequestIdRef.current = reqId;
        setAlert("Unable to create API key. Try again.");
      }
    }

    // Check if the entire overlapping batch has settled
    const stillPending = Array.from(activeRequestsRef.current.values()).filter(
      (r) => !r.success && !r.error
    );

    if (stillPending.length === 0) {
      const currentBatch = Array.from(activeRequestsRef.current.entries());
      activeRequestsRef.current.clear();

      const batchReqIds = currentBatch.map(([id]) => id);
      const newestBatchReqId = Math.max(...batchReqIds);
      const newestReqInBatch = currentBatch.find(([id]) => id === newestBatchReqId);
      const newestReqSucceeded = newestReqInBatch ? newestReqInBatch[1].success : false;

      const anySuccess = currentBatch.some(([_, r]) => r.success);

      if (anySuccess) {
        const batchSize = currentBatch.length;
        refreshingBatchCountRef.current = batchSize;
        setRefreshPending(true);

        const refId = ++refreshCounterRef.current;
        latestStartedRefreshIdRef.current = refId;

        try {
          const refResponse = await fetch("/api/apiKeys");
          if (!refResponse.ok) {
            throw new Error("Refresh failed");
          }
          const json = await refResponse.json();

          if (!json || !Array.isArray(json.apiKeys)) {
            throw new Error("Invalid JSON structure");
          }

          for (const key of json.apiKeys) {
            if (!isValidApiKey(key)) {
              throw new Error("Malformed API key");
            }
          }

          if (refId >= latestStartedRefreshIdRef.current) {
            setApiKeys(sortApiKeys(json.apiKeys));
          }

          if (newestReqSucceeded) {
            if (newestBatchReqId >= maxSettledRequestIdRef.current) {
              maxSettledRequestIdRef.current = newestBatchReqId;
              setAlert(null);
            }
          }
        } catch (err) {
          if (newestBatchReqId >= maxSettledRequestIdRef.current) {
            maxSettledRequestIdRef.current = newestBatchReqId;
            setAlert("Unable to create API key. Try again.");
          }
        } finally {
          if (refId >= latestStartedRefreshIdRef.current) {
            setRefreshPending(false);
          }
        }
      }
    }
  }, []);

  useEffect(() => {
    setApiKeyRows(
      apiKeys.map((apiKey) => [
        apiKey.id,
        JSON.stringify(apiKey.active),
        apiKey.createdAt ? new Date(apiKey.createdAt).toLocaleString("en-US", { timeZone: "UTC" }) : "",
      ])
    );
  }, [apiKeys]);

  const totalActive = pendingCreations > 0 ? pendingCreations : (refreshPending ? refreshingBatchCountRef.current : 0);

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
              {alert && (
                <div role="alert" className="text-red-500 font-bold mb-4">
                  {alert}
                </div>
              )}
              {totalActive > 0 && (
                <div className="text-slate-500 mb-4 font-semibold">
                  {totalActive === 1 ? "Creating API key…" : `Creating ${totalActive} API keys…`}
                </div>
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
