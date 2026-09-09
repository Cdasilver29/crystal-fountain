/**
 * CSV assembly.
 *
 * Plain functions with no database and no Next imports, so a service can build
 * a file and a route handler can hand it out without either knowing about the
 * other.
 */

/*
 * Neutralising a cell that would otherwise run as a formula.
 *
 * This is the reason this module exists rather than a join on commas. A pledger
 * types their own name, and a name beginning with = or @ opens as a formula
 * when the treasurer double clicks the file: at best a broken cell, at worst
 * one that reaches out to a URL the moment it is opened. A leading apostrophe
 * makes the spreadsheet read it as text, which is what it is.
 *
 * The rule is deliberately narrow. An earlier version escaped every leading
 * plus and minus, which put an apostrophe in front of every phone number in the
 * file, because E.164 numbers all begin with one. That is data corruption in
 * the column that matters most: the phone is the pledger's identity key, and an
 * export exists to reproduce the database, not to edit it.
 *
 * So a sign is escaped only when what follows is not simply digits.
 * "+254712345678" and "-1500" are values and pass through untouched;
 * "+cmd|' /c calc'!A1" is a formula and does not. Nothing that can execute gets
 * through either way, because execution needs a function name or a reference,
 * and neither is a run of digits.
 *
 * Tab and carriage return are escaped because some spreadsheets strip leading
 * whitespace before deciding, which would uncover a formula character behind
 * it.
 */
const FORMULA_START = /^[=@\t\r]/;

/** A leading sign followed by anything that is not just digits. */
const SIGNED_NON_NUMERIC = /^[+-](?![0-9]*$)/;

/** Characters that force a field to be quoted. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * One field, escaped for CSV.
 *
 * Null and undefined become an empty field rather than the text "null", which
 * is what a treasurer reading a column of phone numbers expects to see for a
 * pledger who gave none.
 */
export function csvField(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "";

  let text = String(value);

  if (FORMULA_START.test(text) || SIGNED_NON_NUMERIC.test(text)) {
    text = `'${text}`;
  }

  if (NEEDS_QUOTING.test(text)) {
    // A quote inside a quoted field is written twice. RFC 4180.
    text = `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function csvRow(fields: readonly (string | number | bigint | null | undefined)[]): string {
  return fields.map(csvField).join(",");
}

/**
 * A whole file: a header row, the data rows, and CRLF line endings.
 *
 * CRLF because RFC 4180 says so and because Excel on Windows, which is what
 * this file is going to be opened in, is the least forgiving reader of the two.
 *
 * The leading byte order mark is there for the same reason. Without it Excel
 * reads a UTF-8 file as the system code page and turns any accented name into
 * mojibake. Every other reader tolerates it.
 */
export function csvFile(
  header: readonly string[],
  rows: readonly (readonly (string | number | bigint | null | undefined)[])[],
): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * Today in Nairobi, for the filename.
 *
 * en-CA renders as YYYY-MM-DD, and the timezone is pinned so a file downloaded
 * at nine in the evening in Nairobi is not stamped with yesterday, which is
 * what the server's UTC clock would say.
 */
export function exportDateStamp(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}
