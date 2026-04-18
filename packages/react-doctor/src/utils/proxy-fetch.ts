import { FETCH_TIMEOUT_MS } from "../constants.js";

interface GlobalProcessLike {
  env?: Record<string, string | undefined>;
  versions?: { node?: string };
}

const getGlobalProcess = (): GlobalProcessLike | undefined => {
  const candidate = (globalThis as { process?: GlobalProcessLike }).process;
  return candidate?.versions?.node ? candidate : undefined;
};

const readEnvProxy = (): string | undefined => {
  const proc = getGlobalProcess();
  if (!proc?.env) return undefined;
  return proc.env.HTTPS_PROXY ?? proc.env.https_proxy ?? proc.env.HTTP_PROXY ?? proc.env.http_proxy;
};

let isProxyUrlResolved = false;
let resolvedProxyUrl: string | undefined;

const getProxyUrl = (): string | undefined => {
  if (isProxyUrlResolved) return resolvedProxyUrl;
  isProxyUrlResolved = true;
  resolvedProxyUrl = readEnvProxy();
  return resolvedProxyUrl;
};

const createProxyDispatcher = async (proxyUrl: string): Promise<object | null> => {
  try {
    // @ts-expect-error undici is bundled with Node.js 18+ but lacks standalone type declarations
    const { ProxyAgent } = await import("undici");
    return new ProxyAgent(proxyUrl);
  } catch {
    return null;
  }
};

// HACK: Node.js's global fetch (undici) accepts `dispatcher` for proxy routing,
// which isn't part of the standard RequestInit type.
export const proxyFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const proxyUrl = getProxyUrl();
    const dispatcher = proxyUrl ? await createProxyDispatcher(proxyUrl) : null;

    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
  } finally {
    clearTimeout(timeoutId);
  }
};
