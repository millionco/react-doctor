import { BrowserSession, type Viewport } from "@react-doctor/browser";

export interface BrowserToolConnection {
  cdp?: string;
  noLaunch?: boolean;
  viewport?: Viewport;
}

// Attach a fresh session per tool call, act, then disconnect. The page lives in
// the browser (attached over CDP), so each call is cheap and the page persists
// across calls — the same persistent model the CLI's `browser` commands use.
// playwright-core loads lazily inside the session, so a missing install surfaces
// the browser package's own actionable hint (caught by `runTool`).
export const withSession = async <ResultType>(
  connection: BrowserToolConnection,
  useSession: (session: BrowserSession) => Promise<ResultType>,
): Promise<ResultType> => {
  const session = await BrowserSession.attach({
    cdpEndpoint: connection.cdp,
    launch: connection.noLaunch === true ? false : undefined,
  });
  try {
    if (connection.viewport) await session.setViewport(connection.viewport);
    return await useSession(session);
  } finally {
    await session.dispose();
  }
};
