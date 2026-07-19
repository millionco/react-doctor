// rule: window-open-without-noopener
// weakness: control-flow
// source: PR #1000 deep audit 2026-07 (dead router calls cannot prove a destination is same-origin)
import Router from "next/router";

export const openDestination = (destination: string) => {
  if (false) Router.push(destination);
  window.open(destination);
};
