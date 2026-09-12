---
"react-doctor": patch
---

Add `REACT_DOCTOR_NO_SCAN_CACHE` environment variable for granular scan-result cache opt-out. When running React Doctor inside outer task caches (Vite Task, Turborepo, etc.), the scan-result cache's repository fingerprinting (`git status` + dirty-file reads) can make unrelated repository changes invalidate the outer task. Setting `REACT_DOCTOR_NO_SCAN_CACHE=true` disables only the scan-result cache while keeping per-file and sidecar lint caches productive. The existing `REACT_DOCTOR_NO_CACHE` global switch continues to disable all caches.
