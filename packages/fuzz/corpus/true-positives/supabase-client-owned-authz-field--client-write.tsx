// rule: supabase-client-owned-authz-field
// weakness: framework-gating
// source: issue #1312 paired client-side positive control

export const createTeam = async (ownerId: string) => {
  await supabase.from("teams").insert({ ownerId, role: "admin" });
};
