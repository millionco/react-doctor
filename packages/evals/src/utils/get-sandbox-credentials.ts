export interface SandboxCredentials {
  token?: string;
  teamId?: string;
  projectId?: string;
}

export const getSandboxCredentials = (): SandboxCredentials => {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (token && teamId && projectId) return { token, teamId, projectId };
  if (process.env.VERCEL_OIDC_TOKEN) return {};
  throw new Error(
    "Set VERCEL_OIDC_TOKEN or VERCEL_TOKEN, VERCEL_TEAM_ID (or VERCEL_ORG_ID), and VERCEL_PROJECT_ID",
  );
};
