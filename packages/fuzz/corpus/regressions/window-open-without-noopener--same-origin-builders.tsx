// rule: window-open-without-noopener
// weakness: control-flow
// source: PR #1000 corpus sweep (dtale same-origin popups; opener is wanted for app windows)
import { fullPath, buildURL, getLocation } from "./menu-utils";

export const openExport = (dataId: string, exportType: string) => {
  window.open(`${fullPath("/dtale/data-export", dataId)}?type=${exportType}`, "_blank");
};

export const openInNewTab = () => {
  window.open(getLocation().pathname?.replace("/iframe/", "/main/") ?? "", "_blank");
};

export const openHtmlExport = (dataId: string) => {
  const url = buildURL(fullPath("/dtale/data-export", dataId), { export: true });
  window.open(`${window.location.origin}/${url}`, "_blank");
};
