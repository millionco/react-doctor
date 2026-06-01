---
"react-doctor": patch
---

Lint in parallel by default. React Doctor now fans the lint pass across your CPU cores out of the box (previously serial) and automatically falls back to a single worker if a parallel run exhausts system resources (`EAGAIN`/`EMFILE`/`ENFILE`/`ENOMEM`); any other failure still surfaces. Pass `--no-parallel` (or set `REACT_DOCTOR_PARALLEL=0`) to force serial linting, or set `REACT_DOCTOR_PARALLEL=<n>` to pin a worker count. The experimental `--experimental-parallel` flag is replaced by `--no-parallel`.
