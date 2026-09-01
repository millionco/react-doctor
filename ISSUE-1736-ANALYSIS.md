# Issue #1736 Analysis: False Positives in Cleanup Detection

## Summary

Investigation reveals 4 **distinct** root causes, not one unified dataflow issue:

1. **Closure-held cleanup functions** (case 1)
2. **Callback ref disposal contract** (case 2)  
3. **Observer operations across forEach** (case 3)
4. **Allocations in registered event handlers** (case 4)

Each requires a different fix approach. This analysis documents findings for each.

---

## Case 1: Closure Variable Holding Disposer

### Pattern
```typescript
let cleanupObserver = () => {};
const observeHero = () => {
  const observer = new IntersectionObserver(() => {});
  observer.observe(hero);
  return () => observer.disconnect();  // Returns disposer
};
cleanupObserver = observeHero();       // Stores disposer
return () => {
  cleanupObserver();                    // Calls disposer
};
```

### Root Cause
- `cleanupObserver` is mutable and gets reassigned
- Cleanup calls `cleanupObserver()` but rule doesn't follow that it invokes a function that calls `disconnect()`
- Needs dataflow tracking through: mutable variables → function call results → nested cleanup operations

### Complexity
**High** - Requires tracking:
1. Mutable variable assignments within effect scope
2. Function return values stored in those variables
3. Calls to those variables in cleanup following through to actual cleanup operations

### Risk of Over-Gating
**High** - A naive fix could accept patterns where cleanup isn't actually guaranteed.

---

## Case 2: Callback Ref Disposal

### Pattern
```typescript
const setRef = useCallback((el: HTMLDivElement | null) => {
  roRef.current?.disconnect();    // Cleanup on re-call
  roRef.current = null;
  if (!el) return;                // React passes null on unmount
  const ro = new ResizeObserver(() => {});
  ro.observe(el);
  roRef.current = ro;
}, []);
return <div ref={setRef}>{width}</div>;
```

### Root Cause
- Observer created in callback ref function
- Cleanup happens via React's callback ref contract (calls with `null` on unmount)
- Rule doesn't recognize this React-specific disposal pattern

### Complexity
**Medium** - Requires:
1. Recognizing functions passed as `ref` props
2. Understanding they're called with `null` on unmount
3. Verifying cleanup operations on the null-guard branch

### Risk of Over-Gating
**Medium** - Need to ensure the ref function actually cleans up on null, not just checks for it.

---

## Case 3: Observer Operations Across forEach

### Pattern
```typescript
const observer = new IntersectionObserver(() => {});
cards.forEach((card) => observer.observe(card));
return () => observer.disconnect();
```

### Root Cause
- `effect-observer-needs-disconnect` correctly handles this (has `serializeForEachTarget` logic)
- `effect-needs-cleanup` does NOT have equivalent forEach awareness
- `observer.disconnect()` releases ALL observations regardless of how/where `observe()` was called

### Complexity
**Low** - Solution: Make `effect-needs-cleanup` defer to `effect-observer-needs-disconnect` for observer patterns, OR port the forEach-aware tracking.

### Risk of Over-Gating
**Low** - The semantic is clear: `disconnect()` releases everything.

---

## Case 4: Allocations in Event Handlers

### Pattern
```typescript
const onEvent = () => {
  resumeTimer = setTimeout(() => {
    rafId = requestAnimationFrame(() => {});
  }, 1500);
};
window.addEventListener("scroll", onEvent);
return () => {
  window.removeEventListener("scroll", onEvent);
  stopAutoScroll();              // Clears rafId
  if (resumeTimer) clearTimeout(resumeTimer);
};
```

### Root Cause
Per `collect-effect-invoked-functions.ts` (lines 36-40), the rule intentionally does NOT track functions registered with `addEventListener` as "effect-owned." This is to avoid false negatives where handlers can fire after cleanup.

However, when:
1. Handler is registered in effect
2. Handler is removed in cleanup  
3. Resources created by handler are cleaned up

...it's actually safe. The rule currently rejects this pattern.

### Complexity
**High** - Requires rethinking what constitutes "effect-owned" allocations:
1. Must prove handler is removed on all cleanup paths
2. Must track resources created by handler
3. Must verify those resources are cleaned in same cleanup

### Risk of Over-Gating
**Very High** - Easy to create false negatives where handler fires after cleanup or resource isn't properly tracked.

---

## Recommended Approach

### For This PR
Fix **Case 3 only** (forEach + observers):
- Lowest risk
- Clear semantics  
- Existing precedent in `effect-observer-needs-disconnect`

### For Future PRs
- **Case 2** (callback refs): Medium complexity, medium impact
- **Case 1** (closure disposers): High complexity, requires careful dataflow design
- **Case 4** (handler allocations): Needs architectural discussion on "ownership" model

### Why Not Fix All 4?
1. **Different root causes** require different fix strategies
2. **False negatives are worse** than false positives (per playbook)
3. Each case needs independent testing and parity validation
4. Rushing a unified fix risks introducing bugs

---

## Case 3 Implementation Plan

1. Identify where `effect-needs-cleanup` tracks observer `observe()` calls
2. Add forEach-awareness similar to `effect-observer-needs-disconnect`'s `serializeForEachTarget`
3. Recognize that `observer.disconnect()` in cleanup covers all `observe()` calls
4. Add regression tests
5. Run parity to ensure no unintended changes

---

## Testing Matrix

| Case | Issue #1594 (helpers) | This Issue | Expected |
|------|----------------------|------------|----------|
| Helper clears timer | ✅ Pass | N/A | Pass |
| Timer in subscription callback | ✅ Pass | N/A | Pass |
| Timer in promise callback | ❌ Reject | N/A | Reject (correct) |
| Timer in event handler (case 4) | - | ❌ Reject | Pass (but complex) |
| forEach + disconnect (case 3) | - | ❌ Reject | Pass (clear semantic) |
| Closure disposer (case 1) | - | ❌ Reject | Pass (complex dataflow) |
| Callback ref (case 2) | - | ❌ Reject | Pass (React contract) |

---

## Files Requiring Changes (Case 3 Fix)

- `effect-needs-cleanup.ts` - Add forEach tracking for observer operations
- `effect-needs-cleanup-issue-1736.test.ts` - Add test for case 3
- Parity validation across corpus
