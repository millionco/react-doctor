import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverSequentialIndependentAwait } from "./server-sequential-independent-await.js";

describe("server-sequential-independent-await", () => {
  it("flags two genuinely independent sequential awaits", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export const load = async () => {
  const user = await fetchUser();
  const posts = await fetchPosts();
  return { user, posts };
};`,
      { filename: "/repo/app/page.tsx" },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the second await reads names destructured from the first (array of object patterns)", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export default async function Page({ params }: PageProps<"/preview/blog/[slug]">) {
  const [{ slug }, { isEnabled }] = await Promise.all([params, draftMode()]);
  const data = await client.fetch(
    BlogPostQuery,
    { slug },
    isEnabled ? { perspective: "drafts", stega: true } : { next: { revalidate: 3600 } },
  );
  if (!data) notFound();
  return <BlogPostPageUI blogPost={data} />;
}`,
      { filename: "/repo/app/(site)/preview/blog/[slug]/page.tsx" },
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent when the second await reads a deeply nested destructured binding", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export const load = async () => {
  const { data: { token } } = await getSession();
  const profile = await fetchProfile(token);
  return profile;
};`,
      { filename: "/repo/app/page.tsx" },
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
