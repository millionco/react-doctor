import { execSync } from "node:child_process";
import { FETCH_TIMEOUT_MS } from "../constants.js";

const readNpmConfigValue = (key: string): string | undefined => {
  try {
    const value = execSync(`npm config get ${key}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (value && value !== "null" && value !== "undefined") return value;
  } catch {}
  return undefined;
};

const resolveProxyUrl = (): string | undefined =>
  process.env.HTTPS_PROXY ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.http_proxy ??
  readNpmConfigValue("https-proxy") ??
  readNpmConfigValue("proxy");

let isProxyUrlResolved = false;
let resolvedProxyUrl: string | undefined;

const getProxyUrl = (): string | undefined => {
  if (isProxyUrlResolved) return resolvedProxyUrl;
  isProxyUrlResolved = true;
  resolvedProxyUrl = resolveProxyUrl();
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
