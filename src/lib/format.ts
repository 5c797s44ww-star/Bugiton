export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function num(x: number, digits = 2): string {
  return x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function mult(x: number, digits = 2): string {
  return `${num(x, digits)}×`;
}

export function mw(x: number, digits = 1): string {
  return `${num(x, digits)} MW`;
}

export function mwh(x: number, digits = 1): string {
  return `${num(x, digits)} MWh`;
}

export function eur(x: number): string {
  if (Math.abs(x) >= 1_000_000) return `${num(x / 1_000_000, 2)} M€`;
  if (Math.abs(x) >= 1_000) return `${num(x / 1_000, 1)} k€`;
  return `${num(x, 0)} €`;
}
