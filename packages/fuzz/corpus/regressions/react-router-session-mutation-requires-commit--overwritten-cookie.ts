// rule: react-router-session-mutation-requires-commit
// weakness: data-flow-sink
// source: adversarial contract audit of PR #1411
import { createCookieSessionStorage, redirect } from "react-router";

const { commitSession, getSession } = createCookieSessionStorage({
  cookie: { name: "session" },
});

export const action = async ({ request }: { request: Request }) => {
  const session = await getSession(request.headers.get("Cookie"));
  session.set("user", "a");
  let cookie = await commitSession(session);
  cookie = "";
  return redirect("/", { headers: { "Set-Cookie": cookie } });
};
