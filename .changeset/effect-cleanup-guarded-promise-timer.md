---
"oxlint-plugin-react-doctor": patch
---

Stop effect-needs-cleanup from flagging a timer created inside a Promise callback when an effect-scope active flag gates its creation and the returned cleanup both clears the handle and invalidates that flag; a self-rescheduling poll with no such flag still fires.
