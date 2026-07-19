// rule: window-open-without-noopener
// weakness: control-flow
// source: Bugbot review on PR #1392
export const openNestedApiPath = () => {
  const basePath = "/api/v1/";
  window.open(`${basePath}/users`, "_blank");
};
