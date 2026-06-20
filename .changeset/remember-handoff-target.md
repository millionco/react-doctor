---
"react-doctor": patch
---

Remember the post-scan "What would you like to do next?" pick. The interactive handoff prompt now pre-selects whatever the user chose last (an agent, "copy to clipboard", or "skip"), so the common "always hand off to the same agent" path is a single Enter. The choice is remembered per user in the existing CLI state file via a new `Preference` lifecycle primitive; a remembered agent that's since been uninstalled falls back to highlighting the first option, and pressing Esc leaves the prior preference untouched.
