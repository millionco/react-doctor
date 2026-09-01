# Issue #1736 Triage Findings and Recommendation

## Investigation Summary

After deep analysis, this issue encompasses **4 distinct root causes**, each requiring a different fix approach:

1. **Closure-held cleanup functions** - Complex mutable variable dataflow
2. **Callback ref disposal** - React-specific contract recognition  
3. **Observer + forEach** - Clear semantic, lowest complexity
4. **Handler allocations** - Architectural "ownership" model redesign

See `ISSUE-1736-ANALYSIS.md` for detailed technical analysis of each case.

## Recommendation: Split Into Focused Issues

Rather than attempting a unified fix that risks false negatives, I recommend:

### Priority 1: Issue for Case 3 (forEach + observers)
- **Lowest risk, clearest semantics**
- `observer.disconnect()` releases ALL observations regardless of where/how `observe()` was called
- `effect-observer-needs-disconnect` already handles this correctly
- `effect-needs-cleanup` needs equivalent forEach-awareness

### Priority 2: Issue for Case 2 (callback refs)
- Medium complexity, common pattern
- Requires recognizing React's callback ref contract (null on unmount)

### Priority 3: Issue for Case 1 (closure disposers)
- High complexity dataflow through mutable variables
- Needs careful design to avoid false negatives

### Priority 4: Issue for Case 4 (handler allocations)  
- Requires architectural discussion on "effect-owned" function model
- Current design intentionally excludes event handler callbacks per `collect-effect-invoked-functions.ts`

## Why Not Fix All 4 Now?

1. **Different root causes** → different fix strategies
2. **False negatives worse than false positives** (per triage playbook)
3. Each needs independent testing and parity validation  
4. Rushing risks introducing bugs in critical cleanup detection

## Files Modified in This Investigation

- `effect-needs-cleanup-issue-1736.test.ts` - Failing reproduction tests
- `ISSUE-1736-ANALYSIS.md` - Technical analysis of all 4 cases

## Next Steps

1. Maintainer reviews analysis and prioritization
2. Create 4 separate focused issues (or prioritize subset)
3. Implement fixes incrementally with full test coverage
4. Validate each with `rde parity` before merge

This approach ensures correctness over speed, avoiding false negatives that would silence real memory leaks.
