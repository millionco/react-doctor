// rule: window-open-without-noopener
// weakness: control-flow
// source: PR #1000 corpus sweep (locally proven same-origin popup builders)
const fullPath = (path: string, dataId: string) => `${path}/${dataId}`;
const buildURL = (path: string, _options: object) => path;

export const openExport = (dataId: string, exportType: string) => {
  window.open(`${fullPath("/dtale/data-export", dataId)}?type=${exportType}`, "_blank");
};

export const openHtmlExport = (dataId: string) => {
  const url = buildURL(fullPath("/dtale/data-export", dataId), { export: true });
  window.open(`${window.location.origin}/${url}`, "_blank");
};
