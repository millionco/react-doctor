# Preparing react-doctor-rust

Release preparation builds and packs artifacts. It never publishes, tags, or merges. Keep the ordinary CI assemblies private; use the explicit release mode for a reviewable experimental candidate.

## Prepare

Start from the reviewed commit and download its successful Native Oxlint workflow's five `native-oxlint-*` artifacts into `dist/native-oxlint-all`. Verify that its five platform parity jobs, package assembly, and eight installation smokes passed. Assembly checks every binary hash and the current native source fingerprint, so artifacts from different native sources cannot be mixed.

```sh
nr native:rust:assemble -- --artifacts dist/native-oxlint-all --release --version 0.9.13-experimental.0
nr native:rust:pack
nr native:rust:smoke
```

The version is an example candidate, not permission to publish it. Release mode rebuilds the workspace CLI with the candidate version. It bundles the packed CLI and rule plugin into the launcher using [npm bundled dependencies](https://docs.npmjs.com/files/package.json/#bundledependencies); stable packages do not need to be published. Required native execution, configuration, diagnostic reporting, and suppression remain unchanged. Existing `cli.invoked` telemetry carries the build version and existing opt-outs; no additional telemetry is introduced by packaging.

Inspect the six tarballs, `SHA256SUMS`, `package-manifest.json`, and `release-plan.json` in `dist/react-doctor-rust-tarballs`. The release plan records exact versions, tarball hashes, and publication arguments, with all five platform packages before the launcher. Run its commands from that tarball directory. Before requesting publication approval, dry-run each exact tarball there:

```sh
npm publish ./react-doctor-rust-0.9.13-experimental.0.tgz --dry-run --ignore-scripts --access public --tag experimental --registry https://registry.npmjs.org/
```

Repeat with each platform tarball listed in the release plan.

Check the npm registry for existing versions and confirm the publishing account can publish all six unscoped package names. A missing registry entry does not prove permission to claim a name. Published versions cannot be replaced; prepare a new experimental version if any version already exists.

## Publication boundary

Obtain fresh, explicit approval for the exact six package names, versions, and experimental tag in `release-plan.json` before executing its publication arguments. Do not run the repository's general `release` command: that publishes the stable Changesets packages. No release workflow, Git tag, or merge is needed to prepare these artifacts.

After approved publication, run the registry-only smoke on every supported platform:

```sh
nr native:rust:smoke -- --package react-doctor-rust@0.9.13-experimental.0
```

Keep the channel experimental if any install or required-native analysis fails. Promotion requires separate approval and clean platform smokes, complete corpus evidence, and a controlled benchmark showing the documented improvement threshold. The current corpus completeness and performance limitations do not support promotion to the default engine. Generated hooks still invoke `react-doctor`; users must choose `react-doctor-rust` explicitly.
