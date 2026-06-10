---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Fix a false positive in `nextjs-missing-metadata` (#775): an App Router page is no longer flagged as "missing metadata for search previews" when it inherits `metadata` / `generateMetadata` from a co-located or ancestor `layout.*`. Next.js merges metadata down the segment chain, so a page covered by a parent layout's title/description already has search-preview metadata. The rule now walks up the App Router directory tree (bounded, stopping at `app/`) and stays quiet when an ancestor layout supplies metadata; pages with no metadata anywhere in the chain are still flagged.
