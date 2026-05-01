import { useCallback, useEffect, useMemo } from "react";

const createFileRoute = (_path: string) => (options: any) => options;
const createRootRoute = (options: any) => options;
const redirect = (_opts: any) => {
  throw new Error("redirect");
};
const notFound = () => {
  throw new Error("notFound");
};
const navigate = (_opts: any) => {};

export const RootPropertyOrderRoute = createRootRoute({
  loader: async ({ context }: any) => {
    return context.user;
  },
  beforeLoad: async () => {
    return { user: { id: "1" } };
  },
  component: () => <div />,
});

export const PropertyOrderRoute = createFileRoute("/property-order")({
  loader: async ({ context }: any) => {
    return context.user;
  },
  beforeLoad: async () => {
    return { user: { id: "1" } };
  },
  component: () => <div />,
});

export const DirectFetchRoute = createFileRoute("/direct-fetch")({
  loader: async () => {
    const response = await fetch("/api/posts");
    return response.json();
  },
  component: () => <div />,
});

export const UseEffectFetchRoute = createFileRoute("/effect-fetch")({
  component: () => {
    useEffect(() => {
      fetch("/api/data");
    }, []);
    return <div />;
  },
});

export const AnchorRoute = createFileRoute("/anchor")({
  component: () => (
    <div>
      <a href="/about">About</a>
    </div>
  ),
});

const NavigateInRenderComponent = () => {
  const user = null;
  if (!user) navigate({ to: "/login" });
  return <div />;
};

export const NavigateRoute = createFileRoute("/navigate")({
  component: NavigateInRenderComponent,
});

// Regression: navigate() inside a genuinely-deferred callback
// (useCallback, useMemo, useEffect, or a JSX `onXxx` event handler)
// must NOT fire — those callbacks run after render. Pre-fix the rule
// only tracked useEffect / JSX onXxx, so useCallback/useMemo were
// false positives. Helpers like `goHome = () => …` and synchronous
// iteration callbacks like `arr.forEach(…)` are intentionally NOT
// covered here — they ARE reachable during render and the rule
// correctly flags navigate() inside them.
const SafeNavigateComponent = () => {
  const onLogin = useCallback(() => navigate({ to: "/login" }), []);
  const fallbackTarget = useMemo(() => navigate({ to: "/" }), []);
  void fallbackTarget;
  return (
    <button type="button" onClick={() => navigate({ to: "/x" })} onMouseEnter={onLogin}>
      x
    </button>
  );
};

export const SafeNavigateRoute = createFileRoute("/safe-navigate")({
  component: SafeNavigateComponent,
});

// Regression in the OPPOSITE direction: synchronous iteration callbacks
// (Array.prototype.forEach/map/etc.) execute DURING render, so a
// navigate() inside one IS a render-time bug and MUST still fire.
// A pure "any nested function = deferred" model would silently skip
// this — the explicit deferred-callback allow-list is what catches it.
const SyncIterationNavigateComponent = ({ targets }: { targets: string[] }) => {
  targets.forEach((target) => navigate({ to: target }));
  return <div />;
};

export const SyncIterationNavigateRoute = createFileRoute("/sync-iter-navigate")({
  component: SyncIterationNavigateComponent,
});

export const SecretsRoute = createFileRoute("/secrets")({
  loader: async () => {
    const secret = process.env.STRIPE_SECRET_KEY;
    return { secret };
  },
  component: () => <div />,
});

export const RedirectInTryCatchRoute = createFileRoute("/redirect-try")({
  loader: async () => {
    try {
      const post = await Promise.resolve(null);
      if (!post) throw notFound();
    } catch {
      return null;
    }
  },
  component: () => <div />,
});

export const ParallelFetchRoute = createFileRoute("/parallel")({
  loader: async () => {
    const users = await fetch("/api/users").then((r) => r.json());
    const posts = await fetch("/api/posts").then((r) => r.json());
    return { users, posts };
  },
  component: () => <div />,
});
