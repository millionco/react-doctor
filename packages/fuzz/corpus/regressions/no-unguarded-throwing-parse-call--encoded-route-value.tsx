// rule: no-unguarded-throwing-parse-call
// weakness: semantic-intent
// source: PR review of millionco/react-doctor#1000

export const decodeRoutePath = (params: { path: string }) =>
  decodeURIComponent(encodeURIComponent(params.path));

export const decodeRouteHash = () => {
  const encodedHash = encodeURIComponent(location.hash);
  return decodeURIComponent(encodedHash);
};

export const decodeWithCustomHelper = (
  params: { path: string },
  decodeURIComponent: (value: string) => string,
) => decodeURIComponent(params.path);
