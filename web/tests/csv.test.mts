import test from "node:test";
import assert from "node:assert/strict";

import { bandFor } from "../src/lib/confidence.ts";
import { csvCell, recordsToCsv, type ExportableRecord } from "../src/lib/csv.ts";

const base: ExportableRecord = {
  id: "r1",
  createdAt: "2026-10-25T10:00:00.000Z",
  prediction: { breedName: "Gir", confidence: 0.93, modelVersion: "m1", looksLikeCattle: true },
  location: null,
  syncState: "local-only",
  duplicateOf: null,
  note: null,
};

test("formula-looking cells are neutralised", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@sum"), "'@sum");
});

test("commas, quotes and newlines are quoted", () => {
  assert.equal(csvCell("a,b"), "\"a,b\"");
  assert.equal(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(csvCell("line1\nline2"), "\"line1\nline2\"");
  assert.equal(csvCell(null), "");
});

test("a confident cattle result names the breed", () => {
  const rows = recordsToCsv([base], bandFor).split("\r\n");
  const cols = rows[1].split(",");
  assert.equal(cols[2], "Gir"); // stated_breed
  assert.equal(cols[5], "confident match");
});

test("an uncertain result leaves stated_breed empty but keeps the candidate", () => {
  const r = { ...base, prediction: { ...base.prediction, confidence: 0.5 } };
  const cols = recordsToCsv([r], bandFor).split("\r\n")[1].split(",");
  assert.equal(cols[2], "");
  assert.equal(cols[3], "Gir");
  assert.equal(cols[5], "identification uncertain");
});

test("a not-cattle photo never states or suggests a breed", () => {
  const r = { ...base, prediction: { ...base.prediction, confidence: 0.99, looksLikeCattle: false } };
  const cols = recordsToCsv([r], bandFor).split("\r\n")[1].split(",");
  assert.equal(cols[2], "");
  assert.equal(cols[3], "");
  assert.equal(cols[5], "does not look like cattle");
});

test("a hostile note cannot become a formula", () => {
  const r = { ...base, note: "=cmd|' /C calc'!A0" };
  const out = recordsToCsv([r], bandFor);
  assert.ok(out.includes("'=cmd"));
});

test("starts with a BOM and uses CRLF", () => {
  const out = recordsToCsv([base], bandFor);
  assert.ok(out.startsWith("﻿"));
  assert.ok(out.includes("\r\n"));
});
