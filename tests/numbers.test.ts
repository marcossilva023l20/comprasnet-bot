import assert from "node:assert/strict";
import test from "node:test";
import { isBlankNumericValue, normalizeSpreadsheetHeader, parseLocalizedNumber } from "../src/lib/numbers";

test("normalizes Brazilian currency and thousands separators", () => {
  assert.equal(parseLocalizedNumber("R$ 1.234,56"), "1234.56");
  assert.equal(parseLocalizedNumber("R$ 0,00"), "0.00");
  assert.equal(parseLocalizedNumber("1.234.567,89"), "1234567.89");
});

test("accepts English separators and spreadsheet numeric cells", () => {
  assert.equal(parseLocalizedNumber("1,234.56"), "1234.56");
  assert.equal(parseLocalizedNumber(337.47), "337.47");
  assert.equal(parseLocalizedNumber("0.125"), "0.125");
  assert.equal(parseLocalizedNumber("1.234"), "1234");
});

test("matches spreadsheet headers independent of accents and punctuation", () => {
  assert.equal(normalizeSpreadsheetHeader("Valor Unitário (R$)"), "valor unitario r");
  assert.equal(normalizeSpreadsheetHeader("\uFEFFDescrição Detalhada"), "descricao detalhada");
});

test("handles negatives and rejects empty or non-numeric values", () => {
  assert.equal(parseLocalizedNumber("(R$ 1.234,56)"), "-1234.56");
  assert.equal(parseLocalizedNumber("-12,50"), "-12.50");
  assert.equal(parseLocalizedNumber(""), null);
  assert.equal(parseLocalizedNumber("R$ --"), null);
  assert.equal(parseLocalizedNumber(Number.NaN), null);
  assert.equal(isBlankNumericValue("  "), true);
  assert.equal(isBlankNumericValue(null), true);
  assert.equal(isBlankNumericValue("0"), false);
});
