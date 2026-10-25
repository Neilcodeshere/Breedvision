// Guards the translation catalogues. A translator who drops or renames a
// {placeholder} would silently print "{date}" on screen, and a stray key would
// never be used, so both are checked here.
import test from "node:test";
import assert from "node:assert/strict";

import { en } from "../src/i18n/messages/en.ts";
import { hi } from "../src/i18n/messages/hi.ts";
import { mr } from "../src/i18n/messages/mr.ts";
import { ta } from "../src/i18n/messages/ta.ts";
import { te } from "../src/i18n/messages/te.ts";

const catalogues: Record<string, Record<string, string | undefined>> = {
  hi,
  mr,
  ta,
  te,
};
const english = en as Record<string, string>;

const placeholders = (s: string) => (s.match(/\{[a-z]+\}/gi) ?? []).sort();

for (const [code, cat] of Object.entries(catalogues)) {
  test(`${code}: every key exists in English`, () => {
    const extra = Object.keys(cat).filter((k) => !(k in english));
    assert.deepEqual(extra, []);
  });

  test(`${code}: placeholders match the English text`, () => {
    for (const [k, v] of Object.entries(cat)) {
      assert.deepEqual(
        placeholders(v ?? ""),
        placeholders(english[k]),
        `${code} ${k}`,
      );
    }
  });

  test(`${code}: no empty strings`, () => {
    for (const [k, v] of Object.entries(cat)) {
      assert.ok(v && v.trim().length > 0, `${code} ${k} is empty`);
    }
  });

  test(`${code}: covers every key`, () => {
    const missing = Object.keys(english).filter((k) => !(k in cat));
    assert.deepEqual(missing, [], `${code} is missing ${missing.length} keys`);
  });
}
