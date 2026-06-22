---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
"deslop-js": patch
"deslop-cli": patch
---

Update the license to MIT with additional restrictions: the software may not be used as training, fine-tuning, or evaluation data for machine-learning models or AI systems, nor sold or resold as a commercial product or service (e.g. a paid API, SaaS, or hosted/managed service) whose value derives substantially from the software, without prior written permission (contact founders@million.dev). Each version's additional restrictions expire on the second anniversary of its release, after which that version is available under the standard MIT License (an FSL-style grant of future license). Each published package now ships its own up-to-date `LICENSE` file so the terms travel with the tarball.

The `react-doctor` CLI also now prints a one-time notice (once per run) when it detects it is running inside an AI/ML training pipeline or agent sandbox, pointing to the license terms.
