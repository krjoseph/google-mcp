import { parseISO, formatRFC3339, isValid } from 'date-fns';

export function normalizeToRFC3339(input: string): string {
  const parsed = parseISO(input);
  if (!isValid(parsed)) {
    throw new Error("Invalid date");
  }
  return formatRFC3339(parsed, { fractionDigits: 0 });
}
