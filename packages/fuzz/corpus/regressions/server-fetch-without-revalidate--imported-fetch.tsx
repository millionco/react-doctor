// rule: server-fetch-without-revalidate
// weakness: name-heuristic
// source: Rad UI dd8bc14c, docs/app/funding.json/route.tsx

import fetch from "node-fetch";

export const GET = async (): Promise<Response> => {
  const response = await fetch("https://api.github.com/repos/millionco/react-doctor");
  return Response.json(await response.json());
};
