# Fuzz liveness targets

These programs intentionally contain diagnostics. They keep changed rules on their reporting paths during fuzzing so strict runs exercise more than early exits.

False-positive hunting loads only `corpus/regressions/`, where every program is valid by contract.
