import { duration } from "../../lib/api";

export function records(value: unknown): Record<string, any>[] {
  return Array.isArray(value)
    ? value.filter((v) => v && typeof v === "object" && !Array.isArray(v))
    : [];
}
export function object(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
export function number(value: any): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function text(value: any): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "Unavailable";
}
export function age(value: number | null) {
  return value === null
    ? "No sample yet"
    : `${duration(Math.max(0, value))} ago`;
}
