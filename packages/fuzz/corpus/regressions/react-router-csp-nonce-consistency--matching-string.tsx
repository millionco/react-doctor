// rule: react-router-csp-nonce-consistency
// weakness: jsx-string-attribute
// source: Bugbot PR #1411

import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";

export const render = (request, context) =>
  renderToPipeableStream(<ServerRouter context={context} url={request.url} nonce="fixed" />, {
    nonce: "fixed",
  });
