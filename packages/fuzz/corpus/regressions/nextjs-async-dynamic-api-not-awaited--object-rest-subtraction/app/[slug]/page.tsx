// rule: nextjs-async-dynamic-api-not-awaited
// weakness: copy-tracking
// source: PR #1000 independent audit

export default function Page({ params, ...props }) {
  return props.params.slug;
}
