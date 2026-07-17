// rule: server-after-nonblocking
// weakness: wrapper-transparency
// source: PR #1317 adversarial validation

"use server";

import * as NextServer from "next/server";

const serverApi = NextServer as typeof NextServer;

const saveEvent = async (): Promise<void> => {
  serverApi["after"]((() => console.warn("saved")) as () => void);
};
