// rule: react-router-loader-fetch-forwards-signal
// settings: {"react-doctor":{"capabilities":["react-router-framework"]}}
// filename: /project/app/routes/profile.tsx

export async function loader({ request }) {
  await fetch("/direct", { signal: request!.signal! });
  return fetch(request!);
}
