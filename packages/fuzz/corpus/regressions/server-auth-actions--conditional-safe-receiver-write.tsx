// rule: server-auth-actions
// weakness: control-flow
// source: adversarial parity review
// verdict: fail
"use server";

export const updateAccount = async (useRequestLocalValues: boolean) => {
  let values = db;
  if (useRequestLocalValues) values = new FormData();
  values.set(accounts, { disabled: true });
};
