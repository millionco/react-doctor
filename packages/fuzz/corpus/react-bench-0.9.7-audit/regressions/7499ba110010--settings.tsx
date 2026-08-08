// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 7499ba110010198fb7bb24f8d0265481830797602c0dca7dc05664a345873370
import { withSessionSsr } from "../util/session";
import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      prisma.list.findMany({
        where: { organizationId: user.organizationId },
      }),
    ]);

    const sortedApiKeys = [...apiKeys].sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (db !== da) return db - da;
      return String(a.id).localeCompare(String(b.id));
    });

    return {
      props: {
        user: req.session.user,
        apiKeys: JSON.parse(JSON.stringify(sortedApiKeys)),
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

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(() => {
    const initial = Array.isArray(props.apiKeys) ? props.apiKeys : [];
    return initial.map((k) => ({
      ...k,
      createdAt: k.createdAt != null ? new Date(k.createdAt).toISOString() : null,
    }));
  });

  const [alert, setAlert] = useState<string | null>(null);
  const [pendingOps, setPendingOps] = useState(0);

  const createdCountRef = useRef(0);
  const refreshTokenRef = useRef(0);

  const { lists } = props;

  const apiKeyRows = useMemo(() => {
    return apiKeys.map((apiKey) => [
      apiKey.id,
      JSON.stringify(apiKey.active),
      apiKey.createdAt ? new Date(apiKey.createdAt).toLocaleString("en-US", { timeZone: "UTC" }) : "",
    ]);
  }, [apiKeys]);

  const createApiKey = useCallback(async () => {
    const creationId = ++createdCountRef.current;
    setPendingOps((p) => p + 1);

    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      let success = false;
      let json: any = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }

      if (
        response.ok &&
        json &&
        typeof json === "object" &&
        json.apiKey &&
        typeof json.apiKey === "object" &&
        typeof json.apiKey.id === "string"
      ) {
        success = true;
      }

      setPendingOps((p) => p - 1);

      if (creationId === createdCountRef.current) {
        if (success) {
          setAlert(null);
        } else {
          setAlert("Unable to create API key. Try again.");
        }
      }

      if (success) {
        const token = ++refreshTokenRef.current;
        setPendingOps((p) => p + 1);
        try {
          const refreshResponse = await fetch("/api/apiKeys", {
            method: "GET",
          });
          const refreshData: any = await refreshResponse.json();

          if (
            refreshResponse.ok &&
            refreshData &&
            typeof refreshData === "object" &&
            Array.isArray(refreshData.apiKeys)
          ) {
            const valid = refreshData.apiKeys.every((item: unknown) => {
              if (typeof item !== "object" || item === null) return false;
              const o = item as Record<string, unknown>;
              if (typeof o.id !== "string") return false;
              if (typeof o.active !== "boolean") return false;
              if (o.createdAt == null) return false;
              const d = new Date(o.createdAt as string | number);
              return !isNaN(d.getTime());
            });

            if (valid) {
              if (token === refreshTokenRef.current) {
                const sorted = [...refreshData.apiKeys].sort((a: any, b: any) => {
                  const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                  const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                  if (db !== da) return db - da;
                  return String(a.id).localeCompare(String(b.id));
                });
                const normalized = sorted.map((k: any) => ({
                  id: String(k.id),
                  active: Boolean(k.active),
                  createdAt: k.createdAt != null ? new Date(k.createdAt).toISOString() : null,
                }));
                setApiKeys(normalized);
              }
            }
          }
        } catch {
          // unsuccessful refresh; leave table unchanged
          if (creationId === createdCountRef.current) {
            setAlert("Unable to create API key. Try again.");
          }
        } finally {
          setPendingOps((p) => p - 1);
        }
      }
    } catch {
      setPendingOps((p) => p - 1);
      if (creationId === createdCountRef.current) {
        setAlert("Unable to create API key. Try again.");
      }
    }
  }, []);

  const statusText =
    pendingOps > 0
      ? pendingOps === 1
        ? "Creating API key…"
        : `Creating ${pendingOps} API keys…`
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

              {statusText ? (
                <div aria-live="polite" aria-atomic="true" className="mb-2 text-sm font-medium text-slate-600">
                  {statusText}
                </div>
              ) : null}

              {!statusText && alert ? (
                <div role="alert" aria-live="assertive" className="mb-2 text-sm font-medium text-red-600">
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
