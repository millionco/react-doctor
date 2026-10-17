import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup issue #1956", () => {
  it("accepts React Navigation addListener cleanup when receiver is renamed", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      import { useNavigation } from "@react-navigation/native";

      export function RenamedReceiver() {
        const coveredNavigation = useNavigation();

        useEffect(() => {
          const unsubscribe = coveredNavigation.addListener("transitionEnd", () => {});

          return () => {
            unsubscribe();
          };
        }, [coveredNavigation]);

        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts React Navigation addListener cleanup with standard navigation name", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      import { useNavigation } from "@react-navigation/native";

      export function NavigationReceiverControl() {
        const navigation = useNavigation();

        useEffect(() => {
          const unsubscribe = navigation.addListener("transitionEnd", () => {});

          return () => {
            unsubscribe();
          };
        }, [navigation]);

        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts React Navigation addListener cleanup from navigation prop", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";

      export function NavigationFromProp({ navigation }) {
        useEffect(() => {
          const unsubscribe = navigation.addListener("transitionEnd", () => {});

          return () => {
            unsubscribe();
          };
        }, [navigation]);

        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
