// rule: no-tight-body-leading
// weakness: framework-gating
// source: RDE OSS corpus, supabase/supabase examples/auth/nextjs-full

export const Hero = () => (
  <p className="text-3xl leading-tight">
    The fastest way to build apps with a hosted database and authentication platform.
  </p>
);
