// rule: react-router-no-session-mutation-in-loader
// weakness: session-destruction-provenance
// source: Bugbot review of PR #1411
import { createCookieSessionStorage, redirect } from "react-router";

const { destroySession, getSession } = createCookieSessionStorage({
  cookie: { name: "session" },
});

export const loader = async ({ request }: { request: Request }) => {
  const session = await getSession(request.headers.get("Cookie"));
  return redirect("/", {
    headers: { "Set-Cookie": await destroySession(session) },
  });
};
