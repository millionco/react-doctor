// rule: nextjs-metadata-url-consistency
// weakness: duplicate metadata keys use the last property value
// source: automated review on PR #1337
// oxlint-disable no-dupe-keys -- regression seed for JavaScript object overwrite semantics

export const metadata = {
  alternates: { canonical: "/old", canonical: "/docs" },
  openGraph: { url: "/wrong", url: "/docs" },
};

export const Page = () => <main>Documentation</main>;
