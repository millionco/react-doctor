// rule: window-open-without-noopener
// weakness: control-flow
import Router from "next/router";

export const openDestination = (destination: string, shouldNavigate: boolean) => {
  if (shouldNavigate) Router.push(destination);
  window.open(destination);
};
