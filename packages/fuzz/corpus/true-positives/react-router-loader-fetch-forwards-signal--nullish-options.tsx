// rule: react-router-loader-fetch-forwards-signal
// weakness: nullish-fetch-options
// source: Bugbot PR #1411

export async function loader({ request }) {
  await fetch(`${request.url}/profile`, null);
  await fetch(`${request.url}/settings`, undefined);
  return fetch(`${request.url}/team`, void 0);
}
