import test from "node:test";
import assert from "node:assert/strict";

import {
  adjustmentFactor,
  anchorFor,
  estimateValue,
  formatInr,
  pregnancyPremiumInr,
} from "../src/lib/price-reference.ts";

test("a sourced breed uses its own listed range; others fall back to the general range", () => {
  assert.equal(anchorFor("gir").sourced, true);
  assert.equal(anchorFor("gir").lowInr, 50000);
  assert.equal(anchorFor("gir").highInr, 150000);
  const other = anchorFor("some-unlisted-breed");
  assert.equal(other.sourced, false);
  assert.equal(other.lowInr, 40000);
  assert.equal(other.highInr, 90000);
});

test("at the reference yield and not pregnant, the estimate is the breed's typical value", () => {
  const e = estimateValue({ breedId: "gir", milkYieldLitres: 6, pregnant: false });
  assert.equal(e.typicalInr, 87000);
  assert.equal(e.lowInr, 50000);
  assert.equal(e.highInr, 150000);
});

test("more milk and pregnancy raise value; less milk lowers it", () => {
  const base = estimateValue({ breedId: "sahiwal", milkYieldLitres: 6, pregnant: false });
  const more = estimateValue({ breedId: "sahiwal", milkYieldLitres: 12, pregnant: false });
  const preg = estimateValue({ breedId: "sahiwal", milkYieldLitres: 6, pregnant: true });
  const less = estimateValue({ breedId: "sahiwal", milkYieldLitres: 2, pregnant: false });
  assert.ok(more.typicalInr > base.typicalInr);
  assert.ok(preg.typicalInr > base.typicalInr);
  assert.ok(less.typicalInr < base.typicalInr);
});

test("each extra daily litre adds about 4,000 rupees to the typical value", () => {
  const a = estimateValue({ breedId: "gir", milkYieldLitres: 6, pregnant: false });
  const b = estimateValue({ breedId: "gir", milkYieldLitres: 7, pregnant: false });
  assert.ok(Math.abs(b.typicalInr - a.typicalInr - 4000) <= 1000);
});

test("pregnancy is worth the paper's litre ratio times the per-litre value", () => {
  assert.ok(Math.abs(pregnancyPremiumInr() - 6192) < 1);
});

test("the range always contains the typical value and never goes below the floor", () => {
  for (const breedId of ["gir", "vechur", "unlisted"]) {
    for (const y of [0, 2, 6, 10, 20]) {
      for (const p of [false, true]) {
        const e = estimateValue({ breedId, milkYieldLitres: y, pregnant: p });
        assert.ok(e.lowInr <= e.typicalInr && e.typicalInr <= e.highInr, `${breedId} ${y} ${p}`);
        assert.ok(e.lowInr > 0);
      }
    }
  }
  const dry = adjustmentFactor(60000, 0, false);
  assert.ok(dry >= 0.4);
});

test("rupees use Indian digit grouping", () => {
  assert.equal(formatInr(150000), "₹1,50,000");
  assert.equal(formatInr(87000), "₹87,000");
});
