import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney } from "../src/format-money.ts";

test("formats USD by default with two decimals", () => {
  assert.equal(formatMoney(1234), "$12.34");
  assert.equal(formatMoney(0), "$0.00");
});

test("supports known currency symbols", () => {
  assert.equal(formatMoney(500, { currency: "EUR" }), "€5.00");
  assert.equal(formatMoney(500, { currency: "GBP" }), "£5.00");
});

test("treats JPY as a zero-decimal currency", () => {
  assert.equal(formatMoney(1200, { currency: "JPY" }), "¥1,200");
});

test("falls back to an uppercased code prefix for unknown currencies", () => {
  assert.equal(formatMoney(500, { currency: "chf" }), "CHF 5.00");
});

test("renders negatives with a leading minus", () => {
  assert.equal(formatMoney(-1234), "-$12.34");
});

test("trims zero cents only for whole amounts when asked", () => {
  assert.equal(formatMoney(1000, { trimZeroCents: true }), "$10");
  assert.equal(formatMoney(1050, { trimZeroCents: true }), "$10.50");
});

test("groups thousands with commas", () => {
  assert.equal(formatMoney(123456789), "$1,234,567.89");
});
