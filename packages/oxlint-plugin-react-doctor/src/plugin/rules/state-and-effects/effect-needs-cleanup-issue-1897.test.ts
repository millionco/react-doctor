import { describe, expect, test } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup useFocusEffect (issue #1897)", () => {
  test("@react-navigation/native named callback with proper cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

function Screen() {
  const callback = useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      return true;
    });
    return () => subscription.remove();
  }, []);

  useFocusEffect(callback);
}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("@react-navigation/native inline callback with proper cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

function Screen() {
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        return true;
      });
      return () => subscription.remove();
    }, [])
  );
}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("expo-router named callback with proper cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

function Screen() {
  const callback = useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      return true;
    });
    return () => subscription.remove();
  }, []);

  useFocusEffect(callback);
}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("expo-router inline callback with proper cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

function Screen() {
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        return true;
      });
      return () => subscription.remove();
    }, [])
  );
}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("named callback missing cleanup should be reported", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

function Screen() {
  const callback = useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      return true;
    });
    // Missing cleanup
  }, []);

  useFocusEffect(callback);
}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addEventListener");
  });

  test("works with timers and proper cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

function Screen() {
  const callback = useCallback(() => {
    const timer = setTimeout(() => {
      console.log('timeout');
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  useFocusEffect(callback);
}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("works with ResizeObserver and proper cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';

function Screen() {
  const callback = useCallback(() => {
    const observer = new ResizeObserver(() => {});
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  useFocusEffect(callback);
}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("reports ResizeObserver missing cleanup in named callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

function Screen() {
  const callback = useCallback(() => {
    const observer = new ResizeObserver(() => {});
    observer.observe(document.body);
    // Missing cleanup
  }, []);

  useFocusEffect(callback);
}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("observe");
  });
});
