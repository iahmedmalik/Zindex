// Pakistani mobile numbers arrive as "0300 1234567", "+92 300 1234567", "92-300-1234567" or
// "(0300) 123-4567". They are all the same person, so they are all stored as 03001234567.
export function normalisePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0092")) digits = digits.slice(4);
  else if (digits.startsWith("92") && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("3")) digits = "0" + digits;
  return digits;
}
