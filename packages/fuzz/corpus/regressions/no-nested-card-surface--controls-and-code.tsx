// rule: no-nested-card-surface
// weakness: element-role
// source: PR #1337 all-rules parity (0xMassi/stik_app)
export const CardControls = () => (
  <div className="rounded-xl border p-6">
    <button className="rounded-lg border bg-white p-4">Save</button>
    <code className="rounded-lg border bg-white p-4">npm run build</code>
  </div>
);
