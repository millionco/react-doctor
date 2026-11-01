// rule: rules-of-hooks
// weakness: cross-file
// source: Synthetic cookie-backed SDK client factory; absolute-path replay in tests/supabase-server-client.test.ts.
import useGateway from "../../fixtures/ssr-cookie-client/client";
import { cookies as readRequestCookies } from "next/headers";

export async function Page() {
  const requestJar = readRequestCookies();
  return await useGateway(requestJar);
}
