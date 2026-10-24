import { QueryPanel } from "./query-panel";

export default async function Page({ searchParams }) {
  const query = await searchParams;
  return <QueryPanel query={query} />;
}
