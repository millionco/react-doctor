---
"react-doctor": patch
---

Stop lint's pre-spawn setup from starving the overlapped security-scan and supply-chain passes.

The security scan already runs on a cooperative background fiber that overlaps the lint pass, but a forked fiber only advances when the main thread yields — and lint's synchronous pre-spawn prefix (full-scan file discovery plus the per-file cache's content-hash partition over every candidate file) held the event loop until the first oxlint subprocess spawned. The overlapped passes now start immediately: the lint runner hands the loop back once before discovery and yields on the shared cooperative time budget while hashing, and the security scan's own directory walk (previously one unyielding readdir+classify burst before its first budget checkpoint) yields walk-progress markers so large trees can't stall lint subprocess draining or concurrently-scanning sibling projects. Diagnostics are byte-identical and the report order is unchanged.
