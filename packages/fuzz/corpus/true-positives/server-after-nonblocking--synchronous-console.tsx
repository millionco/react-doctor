// rule: server-after-nonblocking
// weakness: control-flow
// source: PR #1317 liveness coverage

"use server";

const saveImmediately = async (): Promise<void> => {
  console.info("still blocks the response");
};
