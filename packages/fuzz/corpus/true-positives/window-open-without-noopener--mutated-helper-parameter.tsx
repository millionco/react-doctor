// rule: window-open-without-noopener
// weakness: helper-parameter-write
export const openMutatedHelperResult = (userControlledUrl: string) => {
  const buildPath = (path: string) => {
    path = userControlledUrl;
    return path;
  };
  window.open(buildPath("/safe"));
};
