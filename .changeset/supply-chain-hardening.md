---
"react-doctor": patch
"@react-doctor/api": patch
---

Security: Harden supply-chain by replacing @latest with version ranges

**Changed:**
- Skill files now use `react-doctor@0.x` instead of `@latest`
- CLI-generated commands use `@0.x` in install scripts, git hooks, and CI configs
- GitHub Action defaults to `0.x` when no version is specified
- Package spec resolver maps `latest` to `0.x` for backward compatibility

**Rationale:**
- Automatic patch and minor updates within the 0.x series
- Protection against breaking changes from 1.0 and beyond
- Better reproducibility while maintaining convenience
- Balances supply-chain security with automatic bug-fix delivery

**For security-sensitive environments:**
- Pin to exact versions: `react-doctor@0.9.1`
- Vendor the runtime playbook (see new SECURITY.md)
- Use lockfiles to pin transitive dependencies

See SECURITY.md for the full trust model, threat boundaries, and hardening options.
