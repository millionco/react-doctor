// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 exact-head audit

interface PageProps {
  params: Promise<{ slug: string }> | { slug: string };
}

const Page = (props: PageProps) => {
  const read = () => {
    props.params = { slug: "safe" };
    return props.params.slug;
  };
  return read();
};

export default Page;
