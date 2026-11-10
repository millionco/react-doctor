import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup — issue 1954 (nullish coalescing receiver)", () => {
  it("should not report when subscribing through a nullish coalescing expression", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from 'react'

			type Navigation = {
				addListener: (type: string, callback: () => void) => () => void
				getParent: () => Navigation | undefined
			}

			declare function useNavigation(): Navigation

			export function NullishReceiver() {
				const navigation = useNavigation()

				useEffect(() => {
					const parent = navigation.getParent()
					const unsubscribe = (parent ?? navigation).addListener('transitionEnd', () => {})

					return () => {
						unsubscribe()
					}
				}, [navigation])

				return null
			}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("should not report when subscribing through an aliased nullish coalescing expression", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from 'react'

			type Navigation = {
				addListener: (type: string, callback: () => void) => () => void
				getParent: () => Navigation | undefined
			}

			declare function useNavigation(): Navigation

			export function AliasedReceiver() {
				const navigation = useNavigation()

				useEffect(() => {
					const target = navigation.getParent() ?? navigation
					const unsubscribe = target.addListener('transitionEnd', () => {})

					return () => {
						unsubscribe()
					}
				}, [navigation])

				return null
			}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("should not report when subscribing through a logical OR expression", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from 'react'

			type Emitter = {
				on: (event: string, handler: () => void) => () => void
			}

			export function LogicalOrReceiver({ primary, fallback }: { primary: Emitter | null, fallback: Emitter }) {
				useEffect(() => {
					const target = primary || fallback
					const unsubscribe = target.on('data', () => {})

					return () => {
						unsubscribe()
					}
				}, [primary, fallback])

				return null
			}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("should not report when subscribing through a logical AND expression with guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from 'react'

			type Emitter = {
				on: (event: string, handler: () => void) => () => void
			}

			export function LogicalAndReceiver({ enabled, emitter }: { enabled: boolean, emitter: Emitter }) {
				useEffect(() => {
					if (!enabled) return

					const target = enabled && emitter
					const unsubscribe = target.on('data', () => {})

					return () => {
						unsubscribe()
					}
				}, [enabled, emitter])

				return null
			}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("should still report when cleanup does not match the receiver", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from 'react'

			type Navigation = {
				addListener: (type: string, callback: () => void) => () => void
				getParent: () => Navigation | undefined
			}

			declare function useNavigation(): Navigation

			export function MismatchedCleanup() {
				const navigation = useNavigation()

				useEffect(() => {
					const parent = navigation.getParent()
					const unsubscribe = (parent ?? navigation).addListener('transitionEnd', () => {})

					return () => {
						// Missing the actual unsubscribe() call
					}
				}, [navigation])

				return null
			}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
