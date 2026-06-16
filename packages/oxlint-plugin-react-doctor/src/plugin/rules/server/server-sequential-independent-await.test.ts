import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverSequentialIndependentAwait } from "./server-sequential-independent-await.js";

describe("server-sequential-independent-await", () => {
  it("flags two genuinely independent consecutive awaits", () => {
    const code = `export default async function Page() {
  const user = await fetchUser();
  const posts = await fetchPosts();
  return null;
}`;

    const result = runRule(serverSequentialIndependentAwait, code);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats names bound by nested array/object destructuring as a dependency (#839)", () => {
    const code = `export default async function Page({ params }) {
  const [{ slug }, { isEnabled }] = await Promise.all([params, draftMode()]);
  const data = await client.fetch(
    BlogPostQuery,
    { slug },
    isEnabled ? { perspective: "drafts" } : { next: { revalidate: 3600 } },
  );
  return data;
}`;

    const result = runRule(serverSequentialIndependentAwait, code);

    expect(result.diagnostics).toEqual([]);
  });

  it("treats names bound by deeply nested object destructuring as a dependency", () => {
    const code = `async function load() {
  const { data: { id } } = await fetchUser();
  const profile = await fetchProfile(id);
  return profile;
}`;

    const result = runRule(serverSequentialIndependentAwait, code);

    expect(result.diagnostics).toEqual([]);
  });

  it("flags independent awaits even when the second re-binds a name the first bound", () => {
    const code = `async function load() {
  const { data } = await fetchPrimary();
  const { data: secondary } = await fetchSecondary();
  return secondary;
}`;

    const result = runRule(serverSequentialIndependentAwait, code);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats a defaulted destructured binding as a dependency", () => {
    const code = `async function load() {
  const { token = "anon" } = await fetchSession();
  const profile = await fetchProfile(token);
  return profile;
}`;

    const result = runRule(serverSequentialIndependentAwait, code);

    expect(result.diagnostics).toEqual([]);
  });
});
