// rule: server-auth-actions
// weakness: framework-gating
// source: emilkowalski/sonner@45d894085af8ca8421912789a8f5a4ac4ac3d0ea test/src/app/action.tsx

"use server";

import { createStreamableUI } from "ai/rsc";

export const streamProgress = async () => {
  const stream = createStreamableUI("loading");
  const interval = setInterval(() => stream.update("still loading"), 100);
  clearInterval(interval);
  return stream.value;
};
