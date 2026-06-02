/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {describe, expect, it} from 'vite-plus/test';
import {verifySource} from '../../verify';

describe('verifier · no-effect-infinite-loop', () => {
  it('proves a VIOLATION for an unstable-dep + unconditional setState loop', () => {
    const report = verifySource(`
      import {useEffect, useState} from 'react';
      function Widget({items}) {
        const [data, setData] = useState(null);
        const config = {items};
        useEffect(() => {
          setData(config);
        }, [config]);
        return <div>{data}</div>;
      }
    `);

    expect(report.verdict).toBe('violation');
    const finding = report.findings.find(
      (f) => f.property === 'no-effect-infinite-loop',
    );
    expect(finding?.verdict).toBe('violation');
    // The witness must be a real counterexample trace.
    expect(finding?.witness.join('\n')).toContain('unbounded re-render');
    expect(finding?.witness.join('\n')).toContain('config');
  });

  it('proves a VIOLATION for a missing dependency array', () => {
    const report = verifySource(`
      import {useEffect, useState} from 'react';
      function Widget() {
        const [n, setN] = useState(0);
        useEffect(() => {
          setN(x => x + 1);
        });
        return <div>{n}</div>;
      }
    `);
    expect(report.verdict).toBe('violation');
  });

  it('clears as SAFE when the dependency is stable (a prop)', () => {
    const report = verifySource(`
      import {useEffect, useState} from 'react';
      function Widget({items}) {
        const [data, setData] = useState(null);
        useEffect(() => {
          setData(items);
        }, [items]);
        return <div>{data}</div>;
      }
    `);
    expect(report.verdict).toBe('safe');
    expect(report.analyzedFunctions).toBeGreaterThan(0);
    expect(report.findings).toHaveLength(0);
  });

  it('clears as SAFE for a mount-only effect (empty deps)', () => {
    const report = verifySource(`
      import {useEffect, useState} from 'react';
      function Widget() {
        const [data, setData] = useState(null);
        useEffect(() => {
          setData(1);
        }, []);
        return <div>{data}</div>;
      }
    `);
    expect(report.verdict).toBe('safe');
  });

  it('returns UNKNOWN for a guarded setState with an unstable dep (not a false alarm)', () => {
    const report = verifySource(`
      import {useEffect, useState} from 'react';
      function Widget({items}) {
        const [data, setData] = useState(null);
        const config = {items};
        useEffect(() => {
          if (config.items.length > 0) {
            setData(config);
          }
        }, [config]);
        return <div>{data}</div>;
      }
    `);
    // A linter would flag this; a verifier cannot prove divergence (the guard
    // might converge) nor safety, so it must say so explicitly.
    expect(report.verdict).toBe('unknown');
    expect(
      report.findings.some(
        (f) => f.property === 'no-effect-infinite-loop' && f.verdict === 'unknown',
      ),
    ).toBe(true);
  });
});

describe('verifier · no-set-state-in-render', () => {
  it('proves a VIOLATION for unconditional setState during render', () => {
    const report = verifySource(`
      import {useState} from 'react';
      function Widget() {
        const [x, setX] = useState(0);
        setX(1);
        return <div>{x}</div>;
      }
    `);
    expect(report.verdict).toBe('violation');
    expect(
      report.findings.some((f) => f.property === 'no-set-state-in-render'),
    ).toBe(true);
  });
});
