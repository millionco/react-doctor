const config: { value: string } | undefined = undefined as { value: string } | undefined;

export const value = config ? config : { value: "default" };

export const nested = config?.value ? config?.value : "fallback";

export const legitTernary = config ? config.value : "x";

export const coerced = !!config;

export const nested_coerced = !!config?.value;

export const notNotNotIsNot = !!!config;

export const condBoolean = config ? true : false;

export const condBooleanInverse = config ? false : true;

export const legitBoolean = config ? "yes" : "no";

const someValue: string | null | undefined = "x";

export const nullCoalesced = someValue ?? null;

export const undefinedCoalesced = someValue ?? undefined;

export const legitCoalesced = someValue ?? "fallback";

export const wordy = someValue !== null && someValue !== undefined;

export const wordyReversed = someValue !== undefined && someValue !== null;

export const legitCheck = someValue !== null && typeof someValue === "string";

console.log(
  value,
  nested,
  legitTernary,
  coerced,
  nested_coerced,
  notNotNotIsNot,
  condBoolean,
  condBooleanInverse,
  legitBoolean,
  nullCoalesced,
  undefinedCoalesced,
  legitCoalesced,
  wordy,
  wordyReversed,
  legitCheck,
);
