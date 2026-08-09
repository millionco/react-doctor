// rule: no-fetch-response-used-without-status-check
// file-path: packages/cli/src/pages/settings.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 59a185f6fb296c6879f95e3ed6c096db76ebaf9c0823ee306ed59156e1fc3dde
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useEffect, useRef, useState } from "react";
import prisma from "../../prisma";
import type { List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";
import { serializeProps } from "../util/serializeProps";
import {
  formatApiKeyCreatedAt,
  parseApiKeysResponse,
  sortApiKeys,
  type SettingsApiKey,
} from "../util/apiKeys";

const API_KEY_CREATE_ERROR = "Unable to create API key. Try again.";

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
        user: req.session.user,
        apiKeys: serializeProps(apiKeys),
        lists: serializeProps(lists),
      },
    };
  }
);

interface Props {
  user: User;
  apiKeys: SettingsApiKey[];
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

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState(() => sortApiKeys(props.apiKeys));
  const [apiKeyRows, setApiKeyRows] = useState<string[][]>([]);
  const [apiKeyAlert, setApiKeyAlert] = useState<string | null>(null);
  const [pendingCreates, setPendingCreates] = useState(0);
  const [pendingRefreshes, setPendingRefreshes] = useState(0);
  const { lists } = props;

  const nextRequestIdRef = useRef(0);
  const pendingCreatesRef = useRef(0);
  const batchHadSuccessRef = useRef(false);
  const awaitingRefreshRef = useRef<Set<number>>(new Set());
  const settledOutcomesRef = useRef<Map<number, "success" | "failure">>(
    new Map()
  );
  const refreshGenerationRef = useRef(0);

  const updateAlertFromSettled = useCallback(() => {
    const settled = settledOutcomesRef.current;
    if (0 === settled.size) {
      setApiKeyAlert(null);
      return;
    }
    const newestSettledId = Math.max(...settled.keys());
    const outcome = settled.get(newestSettledId);
    if ("failure" === outcome) {
      setApiKeyAlert(API_KEY_CREATE_ERROR);
    } else {
      setApiKeyAlert(null);
    }
  }, []);

  const settleRequest = useCallback(
    (requestId: number, outcome: "success" | "failure") => {
      settledOutcomesRef.current.set(requestId, outcome);
      updateAlertFromSettled();
    },
    [updateAlertFromSettled]
  );

  const refreshApiKeys = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    setPendingRefreshes((count) => count + 1);

    let refreshOk = false;
    try {
      const response = await fetch("/api/apiKeys");
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = null;
      }

      if (response.ok) {
        const parsed = parseApiKeysResponse(json);
        if (parsed && generation === refreshGenerationRef.current) {
          setApiKeys(sortApiKeys(parsed));
          refreshOk = true;
        }
      }
    } catch {
      refreshOk = false;
    } finally {
      setPendingRefreshes((count) => count - 1);
    }

    if (generation !== refreshGenerationRef.current) {
      return;
    }

    const awaiting = [...awaitingRefreshRef.current];
    awaitingRefreshRef.current.clear();
    for (const requestId of awaiting) {
      settleRequest(requestId, refreshOk ? "success" : "failure");
    }
  }, [settleRequest]);

  const onBatchSettled = useCallback(() => {
    if (batchHadSuccessRef.current) {
      batchHadSuccessRef.current = false;
      void refreshApiKeys();
    }
  }, [refreshApiKeys]);

  const createApiKey = useCallback(() => {
    const requestId = ++nextRequestIdRef.current;
    pendingCreatesRef.current += 1;
    setPendingCreates(pendingCreatesRef.current);

    void (async () => {
      let postOk = false;
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
          // ignore invalid JSON on create response
        }
        postOk = response.ok;
      } catch {
        postOk = false;
      }

      if (postOk) {
        batchHadSuccessRef.current = true;
        awaitingRefreshRef.current.add(requestId);
      } else {
        settleRequest(requestId, "failure");
      }

      pendingCreatesRef.current -= 1;
      setPendingCreates(pendingCreatesRef.current);

      if (0 === pendingCreatesRef.current) {
        onBatchSettled();
      }
    })();
  }, [onBatchSettled, settleRequest]);

  useEffect(() => {
    setApiKeyRows(
      apiKeys.map((apiKey) => [
        apiKey.id,
        JSON.stringify(apiKey.active),
        apiKey.createdAt ? formatApiKeyCreatedAt(apiKey.createdAt) : "",
      ])
    );
  }, [apiKeys]);

  const pendingWork = pendingCreates + pendingRefreshes;
  const statusMessage =
    0 === pendingWork
      ? null
      : pendingCreates > 1
      ? `Creating ${pendingCreates} API keys…`
      : "Creating API key…";

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
              {statusMessage ? (
                <p className="mb-4 text-slate-400" aria-live="polite">
                  {statusMessage}
                </p>
              ) : null}
              {apiKeyAlert ? (
                <div
                  className="mb-4 bg-red-400 text-black rounded-md py-2 px-3"
                  role="alert"
                >
                  {apiKeyAlert}
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
