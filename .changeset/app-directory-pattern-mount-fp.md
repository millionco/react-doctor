---
"oxlint-plugin-react-doctor": patch
---

fix(rules): path-based framework-directory detection no longer misreads a
filesystem mount point as a framework directory. Rules now check `app/`,
`pages/`, `pages/api/`, and `routes/` against the path relative to the
detected project root (`settings["react-doctor"].rootDirectory`), falling
back to ignoring the leading segment of an absolute path when no root is
available. A pages-router repo checked out at `/app` (the most common
container convention) no longer triggers `nextjs-no-head-import`,
`nextjs-error-boundary-missing-use-client`,
`nextjs-global-error-missing-html-body`,
`nextjs-no-default-export-in-route-handler`, or
`server-fetch-without-revalidate`; the same class of false positive is
fixed for `nextjs-no-client-fetch-for-server-data` (`/pages` mounts),
`server-hoist-static-io` (`/pages` mounts), and the `tanstack-start-*`
route-file rules (`/routes` mounts).
