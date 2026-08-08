// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit c39fbfd1572a0f4f762daebc738fe1e84b489530ac72d7b2169a4212bd55f712
import { withSessionSsr } from "../util/session";
import {
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import prisma from "../../prisma";
import type { List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";
import {
  API_KEY_CREATE_ERROR,
  creatingApiKeysStatusMessage,
  formatApiKeyCreatedAt,
  parseSettingsApiKeysResponse,
  serializeSettingsProps,
  sortSettingsApiKeys,
  SettingsApiKey,
} from "../util/settingsApiKeys";

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
        apiKeys: serializeSettingsProps(apiKeys),
        lists: serializeSettingsProps(lists),
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
  const [apiKeys, setApiKeys] = useState<SettingsApiKey[]>(() =>
    sortSettingsApiKeys(props.apiKeys)
  );
  const [apiKeyRows, setApiKeyRows] = useState<string[][]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const { lists } = props;

  const pendingCreatesRef = useRef(0);
  const pendingRefreshesRef = useRef(0);
  const statusCreateCountRef = useRef(0);
  const successesPendingRefreshRef = useRef(0);
  const requestIdRef = useRef(0);
  const latestSettledRequestIdRef = useRef(0);
  const refreshGenerationRef = useRef(0);

  const updateStatusMessage = useCallback(() => {
    const workPending =
      pendingCreatesRef.current > 0 || pendingRefreshesRef.current > 0;
    if (!workPending) {
      statusCreateCountRef.current = 0;
      setStatusMessage(null);
      return;
    }
    const createCount = Math.max(
      statusCreateCountRef.current,
      pendingCreatesRef.current
    );
    setStatusMessage(creatingApiKeysStatusMessage(createCount));
  }, []);

  const applySettledRequestOutcome = useCallback(
    (requestId: number, succeeded: boolean) => {
      if (requestId < latestSettledRequestIdRef.current) {
        return;
      }
      latestSettledRequestIdRef.current = requestId;
      setAlertMessage(succeeded ? null : API_KEY_CREATE_ERROR);
    },
    []
  );

  const refreshApiKeys = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    pendingRefreshesRef.current++;
    updateStatusMessage();

    let refreshFailed = false;

    try {
      const response = await fetch("/api/apiKeys");
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        refreshFailed = true;
        return;
      }

      const parsed = parseSettingsApiKeysResponse(data);
      if (!response.ok || !parsed) {
        refreshFailed = true;
        return;
      }

      if (generation === refreshGenerationRef.current) {
        setApiKeys(sortSettingsApiKeys(parsed));
      }
    } catch {
      refreshFailed = true;
    } finally {
      pendingRefreshesRef.current--;
      if (
        refreshFailed &&
        generation === refreshGenerationRef.current
      ) {
        setAlertMessage(API_KEY_CREATE_ERROR);
      }
      updateStatusMessage();
    }
  }, [updateStatusMessage]);

  const maybeRefreshAfterCreates = useCallback(() => {
    if (pendingCreatesRef.current > 0) {
      return;
    }
    if (successesPendingRefreshRef.current > 0) {
      successesPendingRefreshRef.current = 0;
      void refreshApiKeys();
    }
  }, [refreshApiKeys]);

  const createApiKey = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    pendingCreatesRef.current++;
    statusCreateCountRef.current = Math.max(
      statusCreateCountRef.current,
      pendingCreatesRef.current
    );
    updateStatusMessage();

    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        applySettledRequestOutcome(requestId, false);
        return;
      }

      const apiKey = (data as { apiKey?: unknown })?.apiKey;
      if (
        !response.ok ||
        !apiKey ||
        typeof apiKey !== "object" ||
        typeof (apiKey as { id?: unknown }).id !== "string"
      ) {
        applySettledRequestOutcome(requestId, false);
        return;
      }

      successesPendingRefreshRef.current++;
      applySettledRequestOutcome(requestId, true);
    } catch {
      applySettledRequestOutcome(requestId, false);
    } finally {
      pendingCreatesRef.current--;
      updateStatusMessage();
      maybeRefreshAfterCreates();
    }
  }, [applySettledRequestOutcome, maybeRefreshAfterCreates, updateStatusMessage]);

  useEffect(() => {
    setApiKeyRows(
      apiKeys.map((apiKey) => [
        apiKey.id,
        JSON.stringify(apiKey.active),
        formatApiKeyCreatedAt(apiKey.createdAt),
      ])
    );
  }, [apiKeys]);

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
                <p className="mb-4 text-sm text-slate-400" aria-live="polite">
                  {statusMessage}
                </p>
              ) : null}
              {alertMessage ? (
                <div className="mb-4 text-sm text-red-500" role="alert">
                  {alertMessage}
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
