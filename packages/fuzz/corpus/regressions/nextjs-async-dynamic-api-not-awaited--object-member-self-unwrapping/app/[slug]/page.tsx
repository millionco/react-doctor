// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 independent audit

export default async function Page(props) {
  props.params = await props.params;
  return props.params.slug;
}
