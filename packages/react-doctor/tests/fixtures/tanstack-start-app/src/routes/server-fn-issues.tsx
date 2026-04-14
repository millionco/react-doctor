const createServerFn = (options?: any) => ({
  middleware: (mw: any[]) => ({
    inputValidator: (schema: any) => ({
      client: (fn: any) => ({
        server: (fn2: any) => ({ handler: (fn3: any) => fn3 }),
      }),
      handler: (fn: any) => fn,
    }),
    handler: (fn: any) => fn,
  }),
  inputValidator: (schema: any) => ({
    handler: (fn: any) => fn,
  }),
  client: (fn: any) => ({
    server: (fn2: any) => ({ handler: (fn3: any) => fn3 }),
  }),
  server: (fn2: any) => ({ handler: (fn3: any) => fn3 }),
  handler: (fn: any) => fn,
});

export const noValidationFn = createServerFn({ method: "POST" }).handler(async ({ data }: any) => {
  return { id: "1", ...data };
});

export const wrongMethodOrder = createServerFn({ method: "POST" }).handler(
  async ({ data }: any) => {
    return data;
  },
);

export const useServerInHandler = createServerFn().handler(async () => {
  "use server";
  return { ok: true };
});

export const getMutationFn = createServerFn().handler(async () => {
  const db = { users: { delete: (_id: string) => {} } };
  await db.users.delete("123");
  return { success: true };
});

export const dynamicImportFn = async () => {
  const mod = await import("~/utils/users.functions");
  return mod;
};
