const displayTimeZone = "Europe/Amsterdam";

export function toNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseAppTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value);
  const hasTimeZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
  const normalized = hasTimeZone ? text : `${text.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: displayTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatLocalTime(value) {
  const date = parseAppTimestamp(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: displayTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatInteger(value, suffix = "") {
  const number = toNumber(value);
  if (number == null) return "-";
  return `${new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(Math.round(number))}${suffix}`;
}

export function formatMetersFromFeet(value) {
  const feet = toNumber(value);
  return feet == null ? "-" : formatInteger(feet * 0.3048, " m");
}

export function formatKmhFromKnots(value) {
  const knots = toNumber(value);
  return knots == null ? "-" : formatInteger(knots * 1.852, " km/h");
}

export function formatMetersPerMinuteFromFeet(value) {
  const feetPerMinute = toNumber(value);
  return feetPerMinute == null ? "-" : formatInteger(feetPerMinute * 0.3048, " m/min");
}

export function formatHeading(value) {
  return formatInteger(value, " deg");
}
