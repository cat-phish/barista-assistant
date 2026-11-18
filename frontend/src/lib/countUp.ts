// Numbers counting up on the Your Year in Coffee slides (backlog 65,
// docs/api/recaps.md §11c "Motion and sound"). Works on the finished text,
// whatever formatted it: "1,234 brews", "≈ 30.5 l", "4.5 ★ Kenya".

export interface NumberParts {
  before: string; // "≈ " or ""
  token: string; // the number as written: "1,234", "4.5"
  after: string; // the rest: " brews"
}

// Only a value that starts with its number counts up ("Saturdays, 7 am" doesn't).
const LEAD = /^(≈\s?)?(\d(?:[\d.,  ']*\d)?)([\s\S]*)$/;

export function splitNumber(value: string): NumberParts | null {
  const m = LEAD.exec(value);
  if (!m) return null;
  return { before: m[1] ?? '', token: m[2]!, after: m[3]! };
}

export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

// The token at a point t (0–1) of the count, keeping its separators. A last
// group that isn't 3 digits long is decimals ("4.5"); 3-digit groups are
// thousands ("1,234").
export function countFrame(token: string, t: number): string {
  if (t >= 1) return token;
  const digits = token.replace(/\D/g, '');
  const groups = token.split(/\D/);
  const decimals = groups.length > 1 && groups[groups.length - 1]!.length !== 3 ? groups[groups.length - 1]!.length : 0;
  const n = Math.round(Number(digits) * easeOut(t));
  const padded = String(n).padStart(digits.length, '0');
  let out = '';
  let k = padded.length - 1;
  for (let i = token.length - 1; i >= 0; i--) out = (/\d/.test(token[i]!) ? padded[k--] : token[i]) + out;
  const cut = decimals ? out.length - decimals - 1 : out.length;
  return out.slice(0, cut).replace(/^[0\D]+(?=\d)/, '') + out.slice(cut);
}
