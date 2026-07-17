// rule: artifact-env-leak
export const databaseUrl = process /* keep */.env.DATABASE_URL;
