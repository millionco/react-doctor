---
"oxlint-plugin-react-doctor": patch
---

fix(rules): `APP_DIRECTORY_PATTERN` no longer treats a repo mounted at `/app`
as the App Router — a leading `/app/` in an absolute path is a filesystem
mount point, so pages-router files like `/app/pages/index.tsx` no longer
trigger `nextjs-no-head-import`, `nextjs-error-boundary-missing-use-client`,
`nextjs-global-error-missing-html-body`, or
`nextjs-no-default-export-in-route-handler`.
