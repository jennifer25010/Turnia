/**
 * Motor de disponibilidad de Turnia.
 *
 * Funciones puras: no acceden a la base de datos ni al reloj del sistema
 * (el reloj llega como parámetro `now`), por lo que se pueden probar sin
 * PostgreSQL.
 *
 * Convenciones:
 * - `weekday`: 0 = domingo ... 6 = sábado (igual que `Date#getDay`).
 * - `startMinute` / `endMinute`: minutos desde las 00:00 en la zona horaria
 *   del negocio. `endMinute` puede ser 1440 (medianoche) y es exclusivo.
 * - Los instantes se manejan siempre como `Date` (UTC) y los intervalos son
 *   semiabiertos [inicio, fin), igual que la restricción de PostgreSQL
 *   `tstzrange(..., '[)')`.
 */

export type Interval = { start: Date; end: Date };

export type WeeklyWindow = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type SlotRejectionReason =
  | "INVALID_START"
  | "PAST"
  | "OUTSIDE_BUSINESS_HOURS"
  | "OUTSIDE_STAFF_AVAILABILITY"
  | "BUSINESS_CLOSED"
  | "STAFF_TIME_OFF";

export type SlotCheck =
  { ok: true } | { ok: false; reason: SlotRejectionReason };

export type BookableSlot = {
  startsAt: string;
  endsAt: string;
  /** Hora local del negocio en formato HH:MM. */
  time: string;
};

export const DEFAULT_SLOT_STEP_MINUTES = 15;

const MINUTE_MS = 60_000;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** Diferencia (zona − UTC) en milisegundos para un instante dado. */
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = zonedParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Valida `YYYY-MM-DD` y que sea una fecha real del calendario. */
export function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Día de la semana (0 = domingo) de una fecha de calendario. */
export function weekdayOfDate(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Convierte "fecha local + minuto del día" en el instante UTC equivalente
 * para la zona horaria indicada. `minuteOfDay` puede llegar a 1440.
 */
export function zonedMinuteToInstant(
  date: string,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const naive = Date.UTC(year, month - 1, day, 0, minuteOfDay, 0);
  let utc = naive - offsetMs(naive, timeZone);
  const corrected = naive - offsetMs(utc, timeZone);
  if (corrected !== utc) utc = corrected;
  return new Date(utc);
}

/** Inicio y fin (exclusivo) de un día calendario en la zona del negocio. */
export function dayBounds(date: string, timeZone: string): Interval {
  return {
    start: zonedMinuteToInstant(date, 0, timeZone),
    end: zonedMinuteToInstant(date, 1440, timeZone),
  };
}

/** Fecha local (YYYY-MM-DD) y minuto del día de un instante en la zona dada. */
export function localDateAndMinute(
  instant: Date,
  timeZone: string,
): { date: string; minuteOfDay: number; hasSubMinute: boolean } {
  const parts = zonedParts(instant, timeZone);
  const date = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  return {
    date,
    minuteOfDay: parts.hour * 60 + parts.minute,
    hasSubMinute: parts.second !== 0 || instant.getUTCMilliseconds() !== 0,
  };
}

function formatMinute(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function windowsFor(
  windows: readonly WeeklyWindow[],
  weekday: number,
): [number, number][] {
  return windows
    .filter(
      (window) =>
        window.weekday === weekday &&
        Number.isInteger(window.startMinute) &&
        Number.isInteger(window.endMinute) &&
        window.startMinute >= 0 &&
        window.endMinute <= 1440 &&
        window.startMinute < window.endMinute,
    )
    .map((window) => [window.startMinute, window.endMinute]);
}

function intersect(
  first: readonly [number, number][],
  second: readonly [number, number][],
): [number, number][] {
  const result: [number, number][] = [];
  for (const [aStart, aEnd] of first) {
    for (const [bStart, bEnd] of second) {
      const start = Math.max(aStart, bStart);
      const end = Math.min(aEnd, bEnd);
      if (start < end) result.push([start, end]);
    }
  }
  return result.sort((left, right) => left[0] - right[0]);
}

function overlaps(
  start: Date,
  end: Date,
  intervals: readonly Interval[],
): boolean {
  return intervals.some(
    (interval) => start < interval.end && end > interval.start,
  );
}

export type CheckSlotInput = {
  timeZone: string;
  startsAt: Date;
  durationMinutes: number;
  businessWindows: readonly WeeklyWindow[];
  staffWindows: readonly WeeklyWindow[];
  closures: readonly Interval[];
  timeOffs: readonly Interval[];
  now: Date;
};

/**
 * Valida una hora de inicio concreta contra horarios del negocio, horarios
 * del profesional, cierres y descansos/ausencias.
 *
 * NO comprueba choques con otras reservas: eso lo garantiza PostgreSQL con
 * la restricción de exclusión `booking_staff_no_overlapping_active`, que es
 * la única forma segura frente a solicitudes simultáneas.
 */
export function checkSlot(input: CheckSlotInput): SlotCheck {
  const { startsAt, durationMinutes, timeZone } = input;

  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0
  ) {
    return { ok: false, reason: "INVALID_START" };
  }

  const local = localDateAndMinute(startsAt, timeZone);
  if (local.hasSubMinute) return { ok: false, reason: "INVALID_START" };

  if (startsAt.getTime() < input.now.getTime()) {
    return { ok: false, reason: "PAST" };
  }

  const weekday = weekdayOfDate(local.date);
  const endMinute = local.minuteOfDay + durationMinutes;
  const fits = (ranges: readonly [number, number][]) =>
    ranges.some(
      ([start, end]) => local.minuteOfDay >= start && endMinute <= end,
    );

  if (!fits(windowsFor(input.businessWindows, weekday))) {
    return { ok: false, reason: "OUTSIDE_BUSINESS_HOURS" };
  }
  if (!fits(windowsFor(input.staffWindows, weekday))) {
    return { ok: false, reason: "OUTSIDE_STAFF_AVAILABILITY" };
  }

  const endsAt = new Date(startsAt.getTime() + durationMinutes * MINUTE_MS);
  if (overlaps(startsAt, endsAt, input.closures)) {
    return { ok: false, reason: "BUSINESS_CLOSED" };
  }
  if (overlaps(startsAt, endsAt, input.timeOffs)) {
    return { ok: false, reason: "STAFF_TIME_OFF" };
  }

  return { ok: true };
}

export type BookableSlotsInput = {
  timeZone: string;
  /** Fecha local del negocio, formato YYYY-MM-DD. */
  date: string;
  durationMinutes: number;
  businessWindows: readonly WeeklyWindow[];
  staffWindows: readonly WeeklyWindow[];
  /** Cierres del negocio, descansos del profesional y reservas activas. */
  blocked: readonly Interval[];
  now: Date;
  stepMinutes?: number;
};

/**
 * Lista los inicios posibles de un servicio en un día: la intersección entre
 * el horario del negocio y el del profesional, descontando bloqueos y
 * excluyendo instantes ya pasados.
 */
export function getBookableSlots(input: BookableSlotsInput): BookableSlot[] {
  const step = input.stepMinutes ?? DEFAULT_SLOT_STEP_MINUTES;
  if (
    !isValidDateString(input.date) ||
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    !Number.isInteger(step) ||
    step <= 0
  ) {
    return [];
  }

  const weekday = weekdayOfDate(input.date);
  const ranges = intersect(
    windowsFor(input.businessWindows, weekday),
    windowsFor(input.staffWindows, weekday),
  );

  const slots: BookableSlot[] = [];
  const seen = new Set<number>();

  for (const [rangeStart, rangeEnd] of ranges) {
    for (
      let minute = rangeStart;
      minute + input.durationMinutes <= rangeEnd;
      minute += step
    ) {
      if (seen.has(minute)) continue;
      seen.add(minute);

      const start = zonedMinuteToInstant(input.date, minute, input.timeZone);
      const end = new Date(start.getTime() + input.durationMinutes * MINUTE_MS);

      if (start.getTime() < input.now.getTime()) continue;
      if (overlaps(start, end, input.blocked)) continue;

      slots.push({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        time: formatMinute(minute),
      });
    }
  }

  return slots;
}
