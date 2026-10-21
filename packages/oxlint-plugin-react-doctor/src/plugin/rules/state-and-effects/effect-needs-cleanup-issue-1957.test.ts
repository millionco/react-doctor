import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runEffectNeedsCleanup = (code: string) => runRule(effectNeedsCleanup, code);

describe("effect-needs-cleanup issue #1957", () => {
  it("accepts async subscription with nullable cleanup", () => {
    const result = runEffectNeedsCleanup(`
			import { useEffect } from 'react'

			type Subscription = { remove: () => void }

			declare const Accelerometer: {
				isAvailableAsync: () => Promise<boolean>
				addListener: (callback: () => void) => Subscription
			}

			export function AsyncSubscribe() {
				useEffect(() => {
					let cancelled = false
					let subscription: Subscription | null = null

					void Accelerometer.isAvailableAsync().then((available) => {
						if (!available || cancelled) return
						subscription = Accelerometer.addListener(() => {})
					})

					return () => {
						cancelled = true
						subscription?.remove()
					}
				}, [])

				return null
			}

			export function SyncSubscribeControl() {
				useEffect(() => {
					const subscription = Accelerometer.addListener(() => {})

					return () => {
						subscription.remove()
					}
				}, [])

				return null
			}
		`);

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts async subscription with explicit null check", () => {
    const result = runEffectNeedsCleanup(`
			import { useEffect } from 'react'

			type Subscription = { remove: () => void }

			declare const Accelerometer: {
				isAvailableAsync: () => Promise<boolean>
				addListener: (callback: () => void) => Subscription
			}

			export function AsyncSubscribeWithExplicitCheck() {
				useEffect(() => {
					let cancelled = false
					let subscription: Subscription | null = null

					void Accelerometer.isAvailableAsync().then((available) => {
						if (!available || cancelled) return
						subscription = Accelerometer.addListener(() => {})
					})

					return () => {
						cancelled = true
						if (subscription !== null) {
							subscription.remove()
						}
					}
				}, [])

				return null
			}
		`);

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts async subscription with logical AND", () => {
    const result = runEffectNeedsCleanup(`
			import { useEffect } from 'react'

			type Subscription = { remove: () => void }

			declare const Accelerometer: {
				isAvailableAsync: () => Promise<boolean>
				addListener: (callback: () => void) => Subscription
			}

			export function AsyncSubscribeWithLogicalAnd() {
				useEffect(() => {
					let cancelled = false
					let subscription: Subscription | null = null

					void Accelerometer.isAvailableAsync().then((available) => {
						if (!available || cancelled) return
						subscription = Accelerometer.addListener(() => {})
					})

					return () => {
						cancelled = true
						subscription && subscription.remove()
					}
				}, [])

				return null
			}
		`);

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts async timer (existing behavior)", () => {
    const result = runEffectNeedsCleanup(`
			import { useEffect } from 'react'

			export function AsyncTimer() {
				useEffect(() => {
					let cancelled = false
					let timer: NodeJS.Timeout | null = null

					void fetch('/api').then(() => {
						if (cancelled) return
						timer = setTimeout(() => {}, 1000)
					})

					return () => {
						cancelled = true
						if (timer !== null) {
							clearTimeout(timer)
						}
					}
				}, [])

				return null
			}
		`);

    expect(result.diagnostics).toEqual([]);
  });

  it("reports async subscription without cleanup", () => {
    const result = runEffectNeedsCleanup(`
			import { useEffect } from 'react'

			type Subscription = { remove: () => void }

			declare const Accelerometer: {
				isAvailableAsync: () => Promise<boolean>
				addListener: (callback: () => void) => Subscription
			}

			export function AsyncSubscribeNoCleanup() {
				useEffect(() => {
					let subscription: Subscription | null = null

					void Accelerometer.isAvailableAsync().then((available) => {
						if (!available) return
						subscription = Accelerometer.addListener(() => {})
					})

					return () => {
						// No cleanup - subscription leaks
					}
				}, [])

				return null
			}
		`);

    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
