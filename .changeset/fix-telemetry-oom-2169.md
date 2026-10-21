---
"@react-doctor/core": patch
"react-doctor": patch
---

fix: reduce telemetry export interval to prevent OOM spikes at shutdown

Fixes a memory issue where the CLI could grow to 4-7 GB and get OOM-killed during telemetry export at exit. The root cause was `TELEMETRY_EXPORT_INTERVAL_MS` being set to 10 minutes (600 seconds), which caused all telemetry data to buffer in memory for the entire scan and then serialize + POST everything at once during shutdown.

Changed the interval from 10 minutes to 30 seconds so spans and metrics are flushed periodically during longer scans instead of accumulating until shutdown. Scans shorter than 30 seconds still export everything at shutdown via scope close, maintaining the same behavior for typical short-lived CLI runs.

Closes #2169
