// rule: react-router-session-mutation-requires-commit
// weakness: session-destruction-sink
// source: Bugbot review of PR #1411
import { createCookieSessionStorage, redirect } from "react-router";

const { destroySession, getSession } = createCookieSessionStorage({
  cookie: { name: "session" },
});

export const action = async ({ request }: { request: Request }) => {
  const session = await getSession(request.headers.get("Cookie"));
  await destroySession(session);
  return redirect("/");
};
