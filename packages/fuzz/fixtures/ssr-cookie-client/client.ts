import { createServerClient as constructClient } from "@supabase/ssr";

export default function makeRequestClient(requestJar) {
  return constructClient(process.env.SESSION_SERVICE_URL, process.env.SESSION_PUBLIC_KEY, {
    cookies: {
      get(cookieName) {
        return requestJar.get(cookieName)?.value;
      },
    },
  });
}
