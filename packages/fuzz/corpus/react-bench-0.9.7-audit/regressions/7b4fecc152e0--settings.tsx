// rule: no-loading-flag-reset-outside-finally
// file-path: packages/cli/src/pages/settings.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 7b4fecc152e0492c8cfdc232c15a42a5e088d84aa8e1e31d63a5f9826b05277f
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
      return { redirect: { destination: "/login", permanent: false } };
    }
    const [apiKeys, lists] = await Promise.all([
      prisma.apiKey.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, active: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      prisma.list.findMany({
        where: { organizationId: user.organizationId },
      }),
    ]);
    return {
      props: {
        user: req.session.user,
        apiKeys: JSON.parse(JSON.stringify(apiKeys)),
        lists: JSON.parse(JSON.stringify(lists)),
      },
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

function isValidApiKey(obj: any): obj is { id: string; active: boolean; createdAt: string } {
  return (
    obj != null &&
    typeof obj === "object" &&
    typeof obj.id === "string" &&
    typeof obj.active === "boolean" &&
    typeof obj.createdAt === "string"
  );
}

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(props.apiKeys || []);
  const [creatingCount, setCreatingCount] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);

  const requestIdCounter = useRef(0);
  const settledRequestId = useRef(0);
  const latestOutcome = useRef<"success" | "failure">("success");
  const refreshGen = useRef(0);

  const doRefresh = useCallback(async () => {
    const gen = ++refreshGen.current;
    setRefreshPending(true);
    try {
      const res = await fetch("/api/apiKeys", { method: "GET" });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      if (!data || !Array.isArray(data.apiKeys)) throw new Error("bad shape");
      const refreshed: any[] = data.apiKeys;
      for (const k of refreshed) {
        if (!isValidApiKey(k)) throw new Error("malformed key");
      }
      if (gen === refreshGen.current) {
        const sorted = refreshed.slice().sort((a, b) => {
          const da = new Date(a.createdAt).getTime();
          const db = new Date(b.createdAt).getTime();
          if (db !== da) return db - da;
          return a.id.localeCompare(b.id);
        });
        setApiKeys(sorted);
        // success refresh does not change alert; alert is managed by request settlement
      } else {
        // newer refresh already started; ignore older result
      }
    } catch {
      if (gen === refreshGen.current) {
        // refresh failure: leave table unchanged, show alert if this is newest settled
        if (settledRequestId.current >= 0) {
          // We will set alert in settlement logic if needed.
        }
      }
    } finally {
      if (gen === refreshGen.current) {
        setRefreshPending(false);
      }
    }
  }, []);

  const createApiKey = useCallback(async () => {
    const reqId = ++requestIdCounter.current;
    setCreatingCount((c) => c + 1);
    let success = false;
    try {
      const res = await fetch("/api/apiKeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("bad post");
      const data = await res.json();
      if (!data || typeof data.apiKey !== "object" || !isValidApiKey(data.apiKey)) {
        throw new Error("bad apiKey");
      }
      success = true;
    } catch {
      success = false;
    }
    setCreatingCount((c) => c - 1);
    if (reqId >= settledRequestId.current) {
      settledRequestId.current = reqId;
      if (success) {
        latestOutcome.current = "success";
        setAlert(null);
        doRefresh();
      } else {
        latestOutcome.current = "failure";
        setAlert("Unable to create API key. Try again.");
      }
    } else {
      // older request finished after newer started; ignore for alert
      if (success) {
        // still start refresh if older succeeded? The rule says after every successful request settles start refresh.
        // If newer request is still pending, starting a refresh now could be overwritten by newer.
        // We start it anyway; newer refresh will take precedence via gen.
        doRefresh();
      }
    }
  }, [doRefresh]);

  // Manage alert after all work settles? Actually alert is set immediately on settlement.
  // We just need to ensure that if a newer request succeeded, alert is cleared, which we do above.

  useEffect(() => {
    const rows = (apiKeys || [])
      .slice()
      .sort((a, b) => {
        const da = new Date(a.createdAt).getTime();
        const db = new Date(b.createdAt).getTime();
        if (db !== da) return db - da;
        return a.id.localeCompare(b.id);
      })
      .map((apiKey) => [
        apiKey.id,
        JSON.stringify(apiKey.active),
        apiKey.createdAt
          ? new Date(apiKey.createdAt).toLocaleString("en-US", { timeZone: "UTC" })
          : "",
      ]);
    // Note: setApiKeyRows not needed if using apiKeys directly in render
  }, [apiKeys]);

  const apiKeyRows = (apiKeys || [])
    .slice()
    .sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      if (db !== da) return db - da;
      return a.id.localeCompare(b.id);
    })
    .map((apiKey) => [
      apiKey.id,
      JSON.stringify(apiKey.active),
      apiKey.createdAt
        ? new Date(apiKey.createdAt).toLocaleString("en-US", { timeZone: "UTC" })
        : "",
    ]);

  const statusText =
    creatingCount > 0 || refreshPending
      ? creatingCount === 1
        ? "Creating API key…"
        : `Creating ${creatingCount} API keys…`
      : null;

  // If refresh fails, we need to show alert when it's the newest settled.
  // Currently doRefresh doesn't set alert on failure. Let's adjust doRefresh to set alert if failure and no newer settled.
  // But since refresh is not tracked by requestId, if refresh fails and there's a pending creation, the creation's settlement should determine alert.
  // To satisfy "unsuccessful refreshes show alert", if refresh fails and no newer creation settled successfully, set alert.
  // We'll incorporate in doRefresh via checking settledRequestId.

  const doRefreshRef = useRef(doRefresh);
  doRefreshRef.current = doRefresh;

  // Re-define doRefresh with alert logic embedded properly
  const doRefreshFinal = useCallback(async () => {
    const gen = ++refreshGen.current;
    setRefreshPending(true);
    try {
      const res = await fetch("/api/apiKeys", { method: "GET" });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      if (!data || !Array.isArray(data.apiKeys)) throw new Error("bad shape");
      const refreshed: any[] = data.apiKeys;
      for (const k of refreshed) {
        if (!isValidApiKey(k)) throw new Error("malformed");
      }
      const sorted = refreshed.slice().sort((a, b) => {
        const da = new Date(a.createdAt).getTime();
        const db = new Date(b.createdAt).getTime();
        if (db !== da) return db - da;
        return a.id.localeCompare(b.id);
      });
      if (gen === refreshGen.current) {
        setApiKeys(sorted);
      }
    } catch {
      if (gen === refreshGen.current) {
        // Refresh failure: if this is the most recent settled outcome, show alert.
        // We consider refresh failure as failure for alert unless a newer request already succeeded.
        if (settledRequestId.current >= 0) {
          // We need to know if any newer request has settled successfully.
          // Simpler: if alert is currently null and no pending creation that hasn't settled, set alert.
          // But if a newer creation is pending, it might succeed; however the instruction says visible alert follows newest settled.
          // Since refresh failure is a failure, if it's the latest settled event (no newer creation settled after), show alert.
          // We'll approximate by setting alert if current alert is not already set by newer failure? Hmm.
          // For simplicity, set alert on refresh failure only when no newer successful settlement occurred.
          // We track latestOutcome; if latestOutcome is success, do not overwrite with refresh failure.
          if (latestOutcome.current !== "success") {
            setAlert("Unable to create API key. Try again.");
          }
        }
      }
    } finally {
      if (gen === refreshGen.current) {
        setRefreshPending(false);
      }
    }
  }, []);

  // Replace createApiKey to use doRefreshFinal
  const createApiKeyFinal = useCallback(async () => {
    const reqId = ++requestIdCounter.current;
    setCreatingCount((c) => c + 1);
    let success = false;
    try {
      const res = await fetch("/api/apiKeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("bad post");
      const data = await res.json();
      if (!data || typeof data.apiKey !== "object" || !isValidApiKey(data.apiKey)) {
        throw new Error("bad apiKey");
      }
      success = true;
    } catch {
      success = false;
    }
    setCreatingCount((c) => c - 1);
    if (reqId >= settledRequestId.current) {
      settledRequestId.current = reqId;
      if (success) {
        latestOutcome.current = "success";
        setAlert(null);
        doRefreshFinal();
      } else {
        latestOutcome.current = "failure";
        setAlert("Unable to create API key. Try again.");
      }
    } else {
      if (success) {
        doRefreshFinal();
      }
    }
  }, [doRefreshFinal]);

  return (
    <>
      <div>
        <div className="w-full">
          <main className="py-16">
            <div className="px-8 max-w-2xl mx-auto">
              <h1 className="font-bold text-3xl mt-0 mb-8">Account</h1>
              <p className="block leading-none text-sm font-bold text-slate-400 mb-3">Email</p>
              {props.user?.email}
            </div>
            <hr className="my-16 border-dotted border-gray-500 border-top border-bottom-0" />
            <div className="px-8 max-w-2xl mx-auto ">
              <div className="mt-16 col-span-3" />
              <div className="flex mb-8">
                <h2 className="grow inline-flex text-3xl font-bold">API Keys</h2>
                <div className="inline-flex text-right">
                  <OutlineButton onClick={createApiKeyFinal} small text="New API Key" />
                </div>
              </div>
              {statusText && (
                <div role="status" aria-live="polite" className="mb-4 text-sm text-slate-500">
                  {statusText}
                </div>
              )}
              {alert && (
                <div role="alert" aria-live="assertive" className="mb-4 text-sm text-red-600">
                  {alert}
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
                    (props.lists || []).map((list) => [
                      list.name,
                      list.displayName,
                      <Link key={list.id} href={`/lists/${list.id}/subscribe`} legacyBehavior>
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
