---
"react-doctor": patch
---

`rn-no-raw-text` now auto-detects in-file custom text wrappers, cutting false positives on design-system `<Text>` forwarders. A component whose returned root is a `<Text>` — e.g. `const Banner = ({ children }) => <Text>{children}</Text>` or `export const Caption = (props) => <Text {...props} />` — is treated as a string-only text forwarder, so raw text passed to it (`<Banner>Hello</Banner>`) no longer reports. Mixed children still report (`<Banner><Icon /> hi</Banner>`) because a single-`<Text>` forwarder can't be trusted to route a JSX child into text. Components only referenced (not defined) in the file keep the existing name-heuristic behavior, and the config-driven `textComponents` / `rawTextWrapperComponents` overrides are unchanged.
