/**
 * NHS number check digit (modulus 11).
 *
 * Multiply each of the first nine digits by a weight from 10 down to 2,
 * add them up, and take 11 minus the remainder after dividing by 11.
 * A result of 11 means a check digit of 0; a result of 10 means the
 * number is invalid. The tenth digit must equal the result.
 */
export function isValidNhsNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return check !== 10 && check === Number(digits[9]);
}

/** The same check as a DuckDB SQL expression over a text column. */
export function nhsChecksumSql(column: string): string {
  const d = `regexp_replace(${column}, '[\\s-]', '', 'g')`;
  const terms = Array.from({ length: 9 }, (_, i) => `${10 - i} * TRY_CAST(substr(${d}, ${i + 1}, 1) AS INTEGER)`);
  return `((11 - ((${terms.join(' + ')}) % 11)) % 11) = TRY_CAST(substr(${d}, 10, 1) AS INTEGER)`;
}
