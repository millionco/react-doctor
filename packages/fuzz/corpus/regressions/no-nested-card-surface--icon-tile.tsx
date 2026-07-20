// rule: no-nested-card-surface
// weakness: element-role
// source: PR #1337 all-rules RDE parity (PostHog/posthog)
export const StatusCard = () => (
  <div className="rounded-xl border p-6">
    <div className="flex size-10 items-center justify-center rounded-full border bg-white">
      <StatusIcon />
    </div>
  </div>
);

export const CompactControls = () => (
  <section className="rounded-xl border p-6">
    <div className="rounded-lg border bg-white p-0.5">Controls</div>
    <div className="rounded-full border bg-white px-2 py-1">Badge</div>
  </section>
);
