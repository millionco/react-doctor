import { describe, expect, it } from "vite-plus/test";
import { lineOfUtf8Offset } from "../src/utils/line-of-utf8-offset.js";

describe("lineOfUtf8Offset", () => {
  it.each([
    "",
    "plain",
    "\n",
    "\r\n",
    "\ra\r",
    "\n\nend\n",
    "café\n🦄\r\n終",
    "first\u2028second\u2029third",
    "a\0b\nc",
  ])("matches the legacy byte scan for %j", (sourceText) => {
    const sourceBuffer = Buffer.from(sourceText);
    const newlineOffsetsBySource = new WeakMap<Buffer, ReadonlyArray<number>>();
    const offsets = [
      Number.NEGATIVE_INFINITY,
      -2,
      -0.5,
      -0,
      ...Array.from({ length: sourceBuffer.length + 3 }, (_, offset) => [
        offset,
        offset + 0.25,
      ]).flat(),
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ];
    for (const offset of offsets) {
      expect(lineOfUtf8Offset(sourceBuffer, offset, newlineOffsetsBySource)).toBe(
        lineOfUtf8Offset(sourceBuffer, offset),
      );
    }
  });

  it("keeps indexes independent for out-of-order queries on distinct buffers", () => {
    const newlineOffsetsBySource = new WeakMap<Buffer, ReadonlyArray<number>>();
    const buffers = [Buffer.from("a\nbbb\nc"), Buffer.from("aaaa\nbc")];
    for (const offset of [7, 0, 5, 1, 6, 2, 7, 0.5, Number.NaN]) {
      for (const sourceBuffer of buffers) {
        expect(lineOfUtf8Offset(sourceBuffer, offset, newlineOffsetsBySource)).toBe(
          lineOfUtf8Offset(sourceBuffer, offset),
        );
      }
    }
  });

  it("counts LF bytes without decoding malformed UTF-8 sequences", () => {
    const sourceBuffer = Buffer.from([0xff, 0x0a, 0xc0, 0x80, 0x0d, 0x0a]);
    const newlineOffsetsBySource = new WeakMap<Buffer, ReadonlyArray<number>>();
    for (const offset of [-1, 0, 0.5, 1, 1.5, 2, 4, 5, 6, 99, Number.NaN]) {
      expect(lineOfUtf8Offset(sourceBuffer, offset, newlineOffsetsBySource)).toBe(
        lineOfUtf8Offset(sourceBuffer, offset),
      );
    }
  });

  it("retains mutable-buffer behavior when callers do not opt into an index", () => {
    const sourceBuffer = Buffer.from("a\nb");
    expect(lineOfUtf8Offset(sourceBuffer, sourceBuffer.length)).toBe(2);
    sourceBuffer[1] = " ".charCodeAt(0);
    expect(lineOfUtf8Offset(sourceBuffer, sourceBuffer.length)).toBe(1);
    sourceBuffer[0] = "\n".charCodeAt(0);
    expect(lineOfUtf8Offset(sourceBuffer, 0.5)).toBe(2);
  });

  it("indexes source bytes once and bounds repeated line lookups logarithmically", () => {
    const sourceBuffer = Buffer.from("line\n".repeat(1000));
    let sourceByteReads = 0;
    const countedBuffer = new Proxy(sourceBuffer, {
      get: (buffer, property) => {
        if (typeof property === "string" && /^\d+$/.test(property)) sourceByteReads += 1;
        return Reflect.get(buffer, property, buffer);
      },
    });
    const newlineOffsetsBySource = new WeakMap<Buffer, ReadonlyArray<number>>();
    expect(lineOfUtf8Offset(countedBuffer, sourceBuffer.length, newlineOffsetsBySource)).toBe(1001);
    const newlineOffsets = newlineOffsetsBySource.get(countedBuffer);
    if (newlineOffsets === undefined) throw new Error("The source line index was not cached");
    let indexedOffsetReads = 0;
    const countedOffsets = new Proxy(newlineOffsets, {
      get: (offsets, property, receiver) => {
        if (typeof property === "string" && /^\d+$/.test(property)) indexedOffsetReads += 1;
        return Reflect.get(offsets, property, receiver);
      },
    });
    newlineOffsetsBySource.set(countedBuffer, countedOffsets);
    const diagnosticCount = 2000;
    for (let diagnosticIndex = 0; diagnosticIndex < diagnosticCount; diagnosticIndex++) {
      const offset =
        diagnosticIndex % 2 === 0
          ? sourceBuffer.length - (diagnosticIndex % sourceBuffer.length)
          : diagnosticIndex % sourceBuffer.length;
      expect(lineOfUtf8Offset(countedBuffer, offset, newlineOffsetsBySource)).toBe(
        lineOfUtf8Offset(sourceBuffer, offset),
      );
    }
    expect(sourceByteReads).toBeLessThanOrEqual(sourceBuffer.length);
    expect(indexedOffsetReads).toBeLessThanOrEqual(
      diagnosticCount * (Math.ceil(Math.log2(newlineOffsets.length + 1)) + 1),
    );
  });
});
