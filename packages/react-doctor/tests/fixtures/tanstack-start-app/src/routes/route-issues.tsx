import { useEffect } from "react";

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

export const SecretsRoute = createFileRoute("/secrets")({
  loader: async () => {
    const secret = process.env.DATABASE_URL;
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
