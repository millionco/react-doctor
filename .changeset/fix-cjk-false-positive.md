---
"oxlint-plugin-react-doctor": patch
---

Fix `no-all-caps-body-text` false positive on CJK text (caseless scripts)

The rule was incorrectly flagging Japanese, Chinese, Korean, and Arabic text as "all caps" because it treated any text without lowercase letters as uppercase. Caseless scripts have no letter case, so they were always flagged.

Now the rule only flags text that actually contains uppercase letters AND lacks lowercase letters. Caseless scripts are skipped entirely.
