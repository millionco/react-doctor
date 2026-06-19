// Current time as an ISO-8601 string. One place so the lifecycle store and the
// lifecycle framework stamp every event/migration record identically.
export const nowIso = (): string => new Date().toISOString();
