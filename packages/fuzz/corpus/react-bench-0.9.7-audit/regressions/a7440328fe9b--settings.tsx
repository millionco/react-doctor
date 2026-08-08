// rule: no-fetch-response-used-without-status-check
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit a7440328fe9b1ca27c2543bb61189e5b2691e4b27d9f01563ed9a6dd177ee863
import { withSessionSsr } from "../util/session";
import { serializeForProps } from "../util/serializeForProps";
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
  CREATE_API_KEY_ERROR,
  formatApiKeyCreatedAt,
  parseApiKeysResponse,
  SettingsApiKey,
  sortApiKeys,
} from "./settings/apiKeyTableUtils";

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
        user: serializeForProps(req.session.user),
        apiKeys: serializeForProps(apiKeys),
        lists: serializeForProps(lists),
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
  const [createError, setCreateError] = useState<string | null>(null);
  const [inFlightCreates, setInFlightCreates] = useState(0);
  const [refreshPending, setRefreshPending] = useState(false);
  const [batchDisplayCount, setBatchDisplayCount] = useState(0);
  const { lists } = props;

  const requestSeqRef = useRef(0);
  const lastSettledRequestSeqRef = useRef(0);
  const inFlightCreatesRef = useRef(0);
  const waveHadSuccessRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const batchDisplayCountRef = useRef(0);

  const refreshApiKeysFromServer = useCallback(async (): Promise<
    "ok" | "failed" | "stale"
  > => {
    const generation = ++refreshGenerationRef.current;
    setRefreshPending(true);
    try {
      const response = await fetch("/api/apiKeys");
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return generation === refreshGenerationRef.current ? "failed" : "stale";
      }
      if (!response.ok) {
        return generation === refreshGenerationRef.current ? "failed" : "stale";
      }
      const parsed = parseApiKeysResponse(json);
      if (!parsed) {
        return generation === refreshGenerationRef.current ? "failed" : "stale";
      }
      if (generation !== refreshGenerationRef.current) return "stale";
      setApiKeys(parsed);
      return "ok";
    } catch {
      return generation === refreshGenerationRef.current ? "failed" : "stale";
    } finally {
      if (generation === refreshGenerationRef.current) {
        setRefreshPending(false);
      }
    }
  }, []);

  const settleCreateRequest = useCallback(
    async (requestSeq: number, succeeded: boolean) => {
      if (requestSeq >= lastSettledRequestSeqRef.current) {
        lastSettledRequestSeqRef.current = requestSeq;
        setCreateError(succeeded ? null : CREATE_API_KEY_ERROR);
      }

      inFlightCreatesRef.current -= 1;
      setInFlightCreates(inFlightCreatesRef.current);

      if (inFlightCreatesRef.current === 0) {
        const shouldRefresh = waveHadSuccessRef.current;
        waveHadSuccessRef.current = false;
        if (shouldRefresh) {
          const refreshResult = await refreshApiKeysFromServer();
          if (
            refreshResult === "failed" &&
            requestSeq >= lastSettledRequestSeqRef.current
          ) {
            setCreateError(CREATE_API_KEY_ERROR);
          }
        }
        if (inFlightCreatesRef.current === 0) {
          batchDisplayCountRef.current = 0;
          setBatchDisplayCount(0);
        }
      }
    },
    [refreshApiKeysFromServer]
  );

  const createApiKey = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current;

    if (inFlightCreatesRef.current === 0) {
      waveHadSuccessRef.current = false;
    }

    inFlightCreatesRef.current += 1;
    batchDisplayCountRef.current = inFlightCreatesRef.current;
    setInFlightCreates(inFlightCreatesRef.current);
    setBatchDisplayCount(batchDisplayCountRef.current);

    let succeeded = false;
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
        await settleCreateRequest(requestSeq, false);
        return;
      }

      if (response.status === 201) {
        succeeded = true;
        waveHadSuccessRef.current = true;
      }
    } catch {
      succeeded = false;
    }

    await settleCreateRequest(requestSeq, succeeded);
  }, [settleCreateRequest]);

  useEffect(() => {
    setApiKeyRows(
      apiKeys.map((apiKey) => [
        apiKey.id,
        JSON.stringify(apiKey.active),
        apiKey.createdAt ? formatApiKeyCreatedAt(apiKey.createdAt) : "",
      ])
    );
  }, [apiKeys]);

  const showCreatingStatus = inFlightCreates > 0 || refreshPending;
  const creatingStatusCount =
    inFlightCreates > 0 ? inFlightCreates : batchDisplayCount || 1;
  const creatingStatusText =
    creatingStatusCount <= 1
      ? "Creating API key…"
      : `Creating ${creatingStatusCount} API keys…`;

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
              {showCreatingStatus ? (
                <p className="mb-4 text-sm text-slate-400" aria-live="polite">
                  {creatingStatusText}
                </p>
              ) : null}
              {createError ? (
                <div className="mb-4" role="alert">
                  {createError}
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
