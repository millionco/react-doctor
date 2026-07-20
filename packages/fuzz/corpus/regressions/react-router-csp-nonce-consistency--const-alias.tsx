// rule: react-router-csp-nonce-consistency
// weakness: alias-equivalence
// source: adversarial contract audit of PR #1411
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";

export const render = (context: object, nonce: string) => {
  const routerNonce = nonce;
  const streamNonce = routerNonce;
  return renderToPipeableStream(<ServerRouter context={context} nonce={routerNonce} />, {
    nonce: streamNonce,
  });
};
