const createFileRoute = (_path: string) => (options: any) => options;
const createRootRoute = (options: any) => options;
const createServerFn = (options?: any) => ({
  inputValidator: (schema: any) => ({ handler: (fn: any) => fn }),
  handler: (fn: any) => fn,
});

export const CorrectPropertyOrder = createFileRoute("/correct")({
  validateSearch: (search: any) => search,
  beforeLoad: async () => ({ user: { id: "1" } }),
  loader: async ({ context }: any) => context.user,
  component: () => <div />,
});

export const RootRouteWithCorrectOrder = createRootRoute({
  beforeLoad: async () => ({ session: {} }),
  loader: async ({ context }: any) => context.session,
  component: () => <div />,
});

export const PutMethodServerFn = createServerFn({ method: "PUT" }).handler(async () => {
  const db = { users: { update: (_data: any) => {} } };
  await db.users.update({ id: "1", name: "updated" });
  return { success: true };
});

export const DeleteMethodServerFn = createServerFn({ method: "DELETE" }).handler(async () => {
  const db = { users: { delete: (_id: string) => {} } };
  await db.users.delete("123");
  return { success: true };
});

export const ValidatedServerFn = createServerFn({ method: "POST" })
  .inputValidator((data: any) => data)
  .handler(async ({ data }: any) => {
    return { id: "1", ...data };
  });

export const CorrectLoaderWithServerFn = createFileRoute("/correct-loader")({
  loader: async () => {
    return { data: "from server fn" };
  },
  component: () => <div />,
});

export const JsonLdScript = () => (
  <div>
    <script type="application/ld+json" src="/structured-data.json" />
  </div>
);

export const DeferredScript = () => (
  <div>
    <script src="https://analytics.example.com/track.js" defer />
  </div>
);

export const AsyncScript = () => (
  <div>
    <script src="https://analytics.example.com/track.js" async />
  </div>
);
