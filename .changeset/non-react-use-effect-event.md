---
"oxlint-plugin-react-doctor": patch
---

Stop `rules-of-hooks` and `no-effect-event-in-deps` from firing on a `useEffectEvent` imported from a non-React package. Both rules match the hook by NAME to stay in parity with eslint-plugin-react-hooks (whose fixtures call a bare global), so a same-named custom hook — e.g. `@rocket.chat/fuselage-hooks`'s `useEffectEvent`, a stable-callback helper designed to be stored and passed as props — was flagged as if it were React's experimental effect event ("only works when called from Effects", "re-runs your effect every render"). Detection is now disambiguated by import source: a `useEffectEvent` explicitly imported from a module outside `REACT_RUNTIME_MODULE_SOURCES` (`react`, `react-dom`, `preact/compat`, `preact/hooks`) is left alone, while React's own and bare/unimported names keep their existing behavior.
