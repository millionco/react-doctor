// Regression fixture for #840: a @sanity/client bundle pairs `createClient`
// with `projectId`/`dataset` and ships role strings, but has no Firebase or
// Supabase config — it must not read as a BaaS authority map.
function createClient(e) {
  return new SanityClient({ allowReconfigure: true, ...e });
}
var defaultConfig = {
  apiVersion: "vX",
  useCdn: true,
  projectId: undefined,
  dataset: undefined,
  perspective: "raw",
};
var grants = { roles: ["administrator", "editor", "viewer"] };
var messages = {
  "asset-source.file.asset-list.delete-successful": "File deleted",
  "asset.locked":
    "Asset is locked, or ask the studio administrator to enable token-based authentication",
};
export { createClient, defaultConfig, grants, messages };
