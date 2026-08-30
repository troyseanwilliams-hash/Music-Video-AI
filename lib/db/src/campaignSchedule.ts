const CAMPAIGN_TIME_ZONE = "America/Indianapolis";
const CAMPAIGN_HOUR = 9;

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInTimeZone(date: Date): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CAMPAIGN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function zonedDateToUtc(year: number, month: number, day: number, hour: number): Date {
  const guessedUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  const localAsUtc = Date.UTC(
    partsInTimeZone(new Date(guessedUtc)).year,
    partsInTimeZone(new Date(guessedUtc)).month - 1,
    partsInTimeZone(new Date(guessedUtc)).day,
    partsInTimeZone(new Date(guessedUtc)).hour,
    partsInTimeZone(new Date(guessedUtc)).minute,
    partsInTimeZone(new Date(guessedUtc)).second,
  );
  return new Date(guessedUtc - (localAsUtc - guessedUtc));
}

export function nextDailyCampaignRunAt(now = new Date()): Date {
  const local = partsInTimeZone(now);
  let candidate = zonedDateToUtc(local.year, local.month, local.day, CAMPAIGN_HOUR);
  if (candidate <= now) {
    const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    const nextLocal = partsInTimeZone(nextDay);
    candidate = zonedDateToUtc(nextLocal.year, nextLocal.month, nextLocal.day, CAMPAIGN_HOUR);
  }
  return candidate;
}

export const DAILY_CAMPAIGN_TIME_ZONE = CAMPAIGN_TIME_ZONE;