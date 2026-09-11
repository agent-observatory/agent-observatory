export function validTimezone(value: string): boolean {
  if (value === "system") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function timezoneFrom(value?: string | null): string {
  return value && validTimezone(value) ? value : "system";
}

export function displayDate(
  value: string,
  language: string,
  timezone: string,
  kind: "date" | "time" | "datetime" = "datetime",
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const zone = timezoneFrom(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    ...(zone === "system" ? {} : { timeZone: zone }),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) =>
    parts.find((p) => p.type === name)?.value || "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}:${part("second")}`;
  return kind === "date" ? day : kind === "time" ? time : `${day} ${time}`;
}
