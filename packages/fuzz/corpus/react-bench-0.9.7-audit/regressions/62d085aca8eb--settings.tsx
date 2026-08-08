// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 62d085aca8ebedc2b67f67448c5683b34938472079e05f3bdca0c1b32921b217
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useEffect, useRef, useState } from "react";
import prisma from "../../prisma";
import type { ApiKey, List, User } from "../../prisma/generated/client";
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

    // Next.js props must contain JSON-safe values. JSON serialization also
    // preserves the existing object shape while converting every Date.
    const serializedProps = JSON.parse(
      JSON.stringify({
        user: req.session.user,
        apiKeys,
        lists,
      })
    );

    return {
      props: serializedProps,
    };
  }
);

interface Props {
  user: User;
  apiKeys: ApiKey[];
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

type ApiKeyRow = Pick<ApiKey, "id" | "active"> & { createdAt: string };

const sortApiKeys = (keys: ApiKeyRow[]) =>
  [...keys].sort((a, b) => {
    const dateDifference =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return dateDifference || a.id.localeCompare(b.id);
  });

const isApiKeyRow = (value: unknown): value is ApiKeyRow => {
  if (!value || typeof value !== "object") return false;

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.active === "boolean" &&
    typeof row.createdAt === "string" &&
    !Number.isNaN(new Date(row.createdAt).getTime())
  );
};

type ApiKeyBatch = {
  pending: number;
  successfulRequestIds: number[];
};

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState(() =>
    sortApiKeys(props.apiKeys as ApiKeyRow[])
  );
  const [apiKeyRows, setApiKeyRows] = useState<string[][]>([]);
  const [alert, setAlert] = useState(false);
  const [pendingWork, setPendingWork] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const nextRequestId = useRef(0);
  const latestSettledRequestId = useRef(0);
  const currentBatch = useRef<ApiKeyBatch | null>(null);
  const nextRefreshId = useRef(0);
  const latestAppliedRefreshId = useRef(0);
  const { lists } = props;

  const createApiKey = useCallback(async () => {
    const requestId = ++nextRequestId.current;
    let batch = currentBatch.current;
    if (!batch) {
      batch = { pending: 0, successfulRequestIds: [] };
      currentBatch.current = batch;
    }
    batch.pending += 1;
    setPendingRequests((count) => count + 1);
    setPendingWork((count) => count + 1);

    let succeeded = false;
    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await response.json();
      succeeded =
        response.ok && !!json?.apiKey && typeof json.apiKey.id === "string";
    } catch {
      succeeded = false;
    } finally {
      setPendingWork((count) => count - 1);
      batch!.pending -= 1;

      if (!succeeded) {
        setPendingRequests((count) => count - 1);
        if (requestId > latestSettledRequestId.current) {
          latestSettledRequestId.current = requestId;
          setAlert(true);
        }
      } else {
        batch!.successfulRequestIds.push(requestId);
      }

      if (batch!.pending === 0) {
        const completedBatch = batch!;
        currentBatch.current = null;
        if (completedBatch.successfulRequestIds.length > 0) {
          const refreshId = ++nextRefreshId.current;
          setPendingWork((count) => count + 1);
          try {
            const refreshResponse = await fetch("/api/apiKeys");
            const refreshJson = await refreshResponse.json();
            const refreshedKeys = refreshJson?.apiKeys;
            if (
              refreshResponse.ok &&
              Array.isArray(refreshedKeys) &&
              refreshedKeys.every(isApiKeyRow)
            ) {
              if (refreshId > latestAppliedRefreshId.current) {
                latestAppliedRefreshId.current = refreshId;
                setApiKeys(sortApiKeys(refreshedKeys));
              }
              const latestRequestId = Math.max(
                ...completedBatch.successfulRequestIds
              );
              if (latestRequestId > latestSettledRequestId.current) {
                latestSettledRequestId.current = latestRequestId;
                setAlert(false);
              }
            } else {
              throw new Error("Unable to refresh API keys");
            }
          } catch {
            const latestRequestId = Math.max(
              ...completedBatch.successfulRequestIds
            );
            if (latestRequestId > latestSettledRequestId.current) {
              latestSettledRequestId.current = latestRequestId;
              setAlert(true);
            }
          } finally {
            setPendingWork((count) => count - 1);
            setPendingRequests(
              (count) => count - completedBatch.successfulRequestIds.length
            );
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
        apiKey.createdAt
          ? new Date(apiKey.createdAt).toLocaleString("en-US", {
              timeZone: "UTC",
            })
          : "",
      ])
    );
  }, [apiKeys]);

  return (
    <>
      <div>
        {alert && (
          <div role="alert" className="px-8 pt-4 text-red-400">
            Unable to create API key. Try again.
          </div>
        )}
        {pendingWork > 0 && (
          <div role="status" aria-live="polite" className="sr-only">
            {pendingRequests > 1
              ? `Creating ${pendingRequests} API keys…`
              : "Creating API key…"}
          </div>
        )}
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
