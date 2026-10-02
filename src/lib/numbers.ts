/**
 * Converts numeric values entered or imported using Brazilian/English locale
 * conventions into a decimal string accepted by PostgreSQL numeric columns.
 *
 * Examples: "R$ 1.234,56" -> "1234.56", "1,234.56" -> "1234.56".
 * A bare comma is treated as a decimal separator (Brazilian convention).
 */
export function parseLocalizedNumber(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value !== "string") return null;

  let input = value.trim();
  if (!input) return null;

  const accountingNegative = /^\(.*\)$/.test(input);
  if (accountingNegative) input = input.slice(1, -1);

  // Currency symbols, spaces and grouping marks vary between spreadsheets.
  input = input.replace(/\s|\u00a0/g, "").replace(/[^\d.,+-]/g, "");
  if (!input || !/\d/.test(input)) return null;

  let sign = "";
  if (input.startsWith("-") || input.startsWith("+")) {
    sign = input[0] === "-" || accountingNegative ? "-" : "";
    input = input.slice(1);
  } else if (accountingNegative) {
    sign = "-";
  }

  // Reject misplaced or duplicated signs rather than silently changing a value.
  if (!input || /[+-]/.test(input)) return null;

  const lastComma = input.lastIndexOf(",");
  const lastDot = input.lastIndexOf(".");
  let decimalSeparator: "," | "." | null = null;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0) {
    decimalSeparator = ",";
  } else if (lastDot >= 0) {
    // A dotted group of exactly three digits is conventionally a thousands
    // separator in Brazilian-formatted text (e.g. "1.234").
    decimalSeparator = /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(input) ? null : ".";
  }

  let integerPart = input;
  let fractionPart = "";
  if (decimalSeparator) {
    const separatorIndex = input.lastIndexOf(decimalSeparator);
    integerPart = input.slice(0, separatorIndex);
    fractionPart = input.slice(separatorIndex + 1);
  }

  integerPart = integerPart.replace(/[.,]/g, "");
  fractionPart = fractionPart.replace(/[.,]/g, "");
  if (!integerPart && !fractionPart) return null;
  if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return null;

  const normalizedInteger = integerPart || "0";
  const normalized = `${sign}${normalizedInteger}${decimalSeparator && fractionPart ? `.${fractionPart}` : ""}`;
  return Number.isFinite(Number(normalized)) ? normalized : null;
}

export function normalizeSpreadsheetHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isBlankNumericValue(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}
