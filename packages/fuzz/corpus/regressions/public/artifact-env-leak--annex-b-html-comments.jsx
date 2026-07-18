// rule: artifact-env-leak
// weakness: other
// source: PR #1320 cross-review
<!-- process.env.DATABASE_URL
var FuzzGeneratedClient = {};
--> process.env.SESSION_SECRET
FuzzGeneratedClient.ready = true;
