---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Add a `shadcn` project capability (detected from `components.json`) and three shadcn component-composition rules: report DialogContent, SheetContent, and AlertDialogContent that render no matching title part and carry no accessible name; report raw Input, Textarea, and Button controls (native or ui-module) placed directly inside InputGroup instead of its InputGroupInput, InputGroupTextarea, and InputGroupAddon parts; and report presence-only `data-[selected]:` / `data-[disabled]:` Tailwind variants on command items, which cmdk renders as `"true"` or `"false"` so the style applies to every item. The existing `shadcn-tabs-trigger-requires-list` rule is now enabled by default for shadcn projects through the same capability gate.
