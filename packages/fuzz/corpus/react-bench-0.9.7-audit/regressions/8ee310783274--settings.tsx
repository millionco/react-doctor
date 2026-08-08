// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 8ee31078327445f9254306523cda5bd414e1d33870230267819bf8b8b454728a
import { withSessionSsr } from "../util/session";
import {
  ReactElement,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import prisma from "../../prisma";
import type { ApiKey, List, User } from "../../prisma/generated/client";
import OutlineButton from "../components/ui/OutlineButton";
import Table from "../components/ui/Table";
import Link from "next/link";
import {
  formatApiKeyCreatedAt,
  parseApiKeysResponse,
  sortApiKeys,
  type SettingsApiKey,
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

const CREATE_ERROR_MESSAGE = "Unable to create API key. Try again.";

function Settings(props: Props) {
  const [apiKeys, setApiKeys] = useState<SettingsApiKey[]>(
    sortApiKeys(props.apiKeys as SettingsApiKey[])
  );
  const [showCreateError, setShowCreateError] = useState(false);
  const [inFlightCreates, setInFlightCreates] = useState(0);
  const [inFlightRefreshes, setInFlightRefreshes] = useState(0);

  const inFlightCreatesRef = useRef(0);
  const batchHadSuccessRef = useRef(false);
  const batchMaxRequestIdRef = useRef(0);
  const requestIdRef = useRef(0);
  const newestSettledRequestIdRef = useRef(0);
  const refreshGenerationRef = useRef(0);

  const { lists } = props;

  const applySettledOutcome = useCallback(
    (requestId: number, success: boolean) => {
      if (requestId < newestSettledRequestIdRef.current) {
        return;
      }
      newestSettledRequestIdRef.current = requestId;
      setShowCreateError(!success);
    },
    []
  );

  const refreshApiKeys = useCallback(
    async (requestId: number) => {
      const generation = ++refreshGenerationRef.current;
      setInFlightRefreshes((count) => count + 1);

      try {
        const response = await fetch("/api/apiKeys");
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          if (generation === refreshGenerationRef.current) {
            applySettledOutcome(requestId, false);
          }
          return;
        }

        if (!response.ok) {
          if (generation === refreshGenerationRef.current) {
            applySettledOutcome(requestId, false);
          }
          return;
        }

        const parsed = parseApiKeysResponse(
          (json as { apiKeys?: unknown }).apiKeys
        );
        if (parsed === null) {
          if (generation === refreshGenerationRef.current) {
            applySettledOutcome(requestId, false);
          }
          return;
        }

        if (generation === refreshGenerationRef.current) {
          setApiKeys(parsed);
          applySettledOutcome(requestId, true);
        }
      } catch {
        if (generation === refreshGenerationRef.current) {
          applySettledOutcome(requestId, false);
        }
      } finally {
        setInFlightRefreshes((count) => count - 1);
      }
    },
    [applySettledOutcome]
  );

  const createApiKey = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    batchMaxRequestIdRef.current = Math.max(
      batchMaxRequestIdRef.current,
      requestId
    );

    inFlightCreatesRef.current += 1;
    setInFlightCreates(inFlightCreatesRef.current);

    try {
      const response = await fetch("/api/apiKeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        applySettledOutcome(requestId, false);
        return;
      }

      if (!response.ok) {
        applySettledOutcome(requestId, false);
        return;
      }

      const apiKey = (json as { apiKey?: unknown }).apiKey;
      const parsed = parseApiKeysResponse([apiKey]);
      if (parsed === null) {
        applySettledOutcome(requestId, false);
        return;
      }

      batchHadSuccessRef.current = true;
    } catch {
      applySettledOutcome(requestId, false);
    } finally {
      inFlightCreatesRef.current -= 1;
      setInFlightCreates(inFlightCreatesRef.current);

      if (inFlightCreatesRef.current === 0) {
        const shouldRefresh = batchHadSuccessRef.current;
        const refreshRequestId = batchMaxRequestIdRef.current;
        batchHadSuccessRef.current = false;
        batchMaxRequestIdRef.current = 0;

        if (shouldRefresh) {
          void refreshApiKeys(refreshRequestId);
        }
      }
    }
  }, [applySettledOutcome, refreshApiKeys]);

  const apiKeyRows = useMemo(
    () =>
      apiKeys.map((apiKey) => [
        apiKey.id,
        JSON.stringify(apiKey.active),
        apiKey.createdAt ? formatApiKeyCreatedAt(apiKey.createdAt) : "",
      ]),
    [apiKeys]
  );

  const statusMessage = useMemo(() => {
    if (inFlightCreates === 0 && inFlightRefreshes === 0) {
      return null;
    }
    if (inFlightCreates === 1 && inFlightRefreshes === 0) {
      return "Creating API key…";
    }
    if (inFlightCreates > 1) {
      return `Creating ${inFlightCreates} API keys…`;
    }
    return "Creating API key…";
  }, [inFlightCreates, inFlightRefreshes]);

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
              {showCreateError ? (
                <div
                  className="mb-4 bg-red-400 text-black rounded-md py-2 px-3"
                  role="alert"
                >
                  {CREATE_ERROR_MESSAGE}
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
