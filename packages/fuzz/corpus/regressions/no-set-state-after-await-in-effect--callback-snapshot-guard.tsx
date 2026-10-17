// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: synthetic
// verdict: pass

import { useCallback, useEffect, useRef, useState } from "react";

interface SnapshotInput {
  id: string;
}

declare const load: (id: string) => Promise<string>;

export const useSnapshotValue = ({ id }: SnapshotInput) => {
  const [value, setValue] = useState("");
  const sequence = useRef(0);
  const update = useCallback(async () => {
    const snapshot = sequence.current;
    const result = await load(id);
    if (snapshot === sequence.current) setValue(result);
  }, [id]);
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);
  useEffect(() => {
    sequence.current++;
    updateRef.current();
  }, [id]);
  return value;
};

export const usePatternSnapshotValue = ({ id }: SnapshotInput) => {
  const [value, setValue] = useState("");
  const sequence = useRef(0);
  const update = useCallback(async () => {
    const { current: snapshot } = sequence;
    const saved = snapshot;
    const result = await load(id);
    const { current: latest } = sequence;
    if (saved === latest) setValue(result);
  }, [id]);
  useEffect(() => {
    sequence.current++;
    update();
  }, [id]);
  return value;
};

export const useArraySnapshotValue = ({ id }: SnapshotInput) => {
  const [value, setValue] = useState("");
  const sequence = useRef(0);
  const update = useCallback(async () => {
    const snapshot = [sequence.current];
    const result = await load(id);
    const latest = [sequence.current];
    if (snapshot[0] === latest[0]) setValue(result);
  }, [id]);
  useEffect(() => {
    sequence.current++;
    update();
  }, [id]);
  return value;
};

export const useAssignedSnapshotValue = ({ id }: SnapshotInput) => {
  const [value, setValue] = useState("");
  const sequence = useRef(0);
  const update = useCallback(async () => {
    let snapshot;
    snapshot = [sequence.current];
    const result = await load(id);
    let latest;
    latest = [sequence.current];
    if (snapshot[0] === latest[0]) setValue(result);
  }, [id]);
  useEffect(() => {
    sequence.current++;
    update();
  }, [id]);
  return value;
};

export const useReaderSnapshotValue = ({ id }: SnapshotInput) => {
  const [value, setValue] = useState("");
  const generation = useRef(0);
  const sequence = useRef(() => generation.current);
  const update = useCallback(async () => {
    const snapshot = [sequence.current()];
    const result = await load(id);
    const latest = [sequence.current()];
    if (snapshot[0] === latest[0]) setValue(result);
  }, [id]);
  useEffect(() => {
    generation.current++;
    update();
  }, [id]);
  return value;
};

export const useComputedLiveGuard = ({ id }: SnapshotInput) => {
  const [value, setValue] = useState("");
  const generation = useRef(0);
  const live = useRef(false);
  const readVersion = () => generation.current;
  const run = useCallback(async () => {
    const snapshot = readVersion();
    await load(id);
    live.current = snapshot === readVersion();
    if (live.current) setValue(id);
  }, [id]);
  useEffect(() => {
    generation.current++;
    run();
  }, [id]);
  return value;
};
