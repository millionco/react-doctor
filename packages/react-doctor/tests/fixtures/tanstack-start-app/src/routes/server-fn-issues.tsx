const chainable: any = new Proxy(
  {},
  {
    get:
      (_target, _prop) =>
      (..._args: any[]) =>
        chainable,
  },
);
const createServerFn = (_options?: any) => chainable;

export const noValidationFn = createServerFn({ method: "POST" }).handler(async ({ data }: any) => {
  return { id: "1", ...data };
});

export const wrongMethodOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: any) => data)
  .inputValidator((data: any) => data);

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
