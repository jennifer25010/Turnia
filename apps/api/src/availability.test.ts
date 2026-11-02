import { describe, expect, it } from "vitest";
import {
  checkSlot,
  dayBounds,
  getBookableSlots,
  isValidDateString,
  localDateAndMinute,
  weekdayOfDate,
  zonedMinuteToInstant,
  type WeeklyWindow,
} from "./availability.js";

const BOGOTA = "America/Bogota";
const weekdays = (days: number[], from = 8 * 60, to = 18 * 60) =>
  days.map<WeeklyWindow>((weekday) => ({
    weekday,
    startMinute: from,
    endMinute: to,
  }));

const MON_TO_SAT = weekdays([1, 2, 3, 4, 5, 6]);
const NOW = new Date("2026-10-20T12:00:00.000Z");

describe("utilidades de fecha y zona horaria", () => {
  it("valida fechas reales de calendario", () => {
    expect(isValidDateString("2026-10-26")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-2-3")).toBe(false);
    expect(isValidDateString("no-es-fecha")).toBe(false);
  });

  it("calcula el día de la semana (0 = domingo)", () => {
    expect(weekdayOfDate("2026-10-25")).toBe(0);
    expect(weekdayOfDate("2026-10-26")).toBe(1);
  });

  it("convierte hora local de Bogotá a UTC (UTC-5 sin horario de verano)", () => {
    expect(
      zonedMinuteToInstant("2026-10-26", 10 * 60, BOGOTA).toISOString(),
    ).toBe("2026-10-26T15:00:00.000Z");
  });

  it("respeta el cambio de horario de verano en otras zonas", () => {
    const zone = "America/New_York";
    // 2026-03-08 es el día en que EE. UU. adelanta el reloj.
    expect(
      zonedMinuteToInstant("2026-03-07", 10 * 60, zone).toISOString(),
    ).toBe("2026-03-07T15:00:00.000Z");
    expect(
      zonedMinuteToInstant("2026-03-08", 10 * 60, zone).toISOString(),
    ).toBe("2026-03-08T14:00:00.000Z");
  });

  it("obtiene fecha local y minuto del día de un instante", () => {
    const local = localDateAndMinute(
      new Date("2026-10-27T03:30:00.000Z"),
      BOGOTA,
    );
    expect(local.date).toBe("2026-10-26");
    expect(local.minuteOfDay).toBe(22 * 60 + 30);
    expect(local.hasSubMinute).toBe(false);
  });

  it("calcula los límites de un día local", () => {
    const bounds = dayBounds("2026-10-26", BOGOTA);
    expect(bounds.start.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-27T05:00:00.000Z");
  });
});

describe("getBookableSlots", () => {
  const base = {
    timeZone: BOGOTA,
    date: "2026-10-26",
    durationMinutes: 30,
    businessWindows: MON_TO_SAT,
    staffWindows: MON_TO_SAT,
    blocked: [],
    now: NOW,
  };

  it("genera horarios cada 15 minutos dentro de la jornada", () => {
    const times = getBookableSlots(base).map((slot) => slot.time);
    expect(times[0]).toBe("08:00");
    expect(times[1]).toBe("08:15");
    expect(times[times.length - 1]).toBe("17:30");
    expect(times).toHaveLength(39);
  });

  it("devuelve instantes UTC correctos", () => {
    const first = getBookableSlots(base)[0]!;
    expect(first.startsAt).toBe("2026-10-26T13:00:00.000Z");
    expect(first.endsAt).toBe("2026-10-26T13:30:00.000Z");
  });

  it("usa la intersección entre el horario del negocio y el del empleado", () => {
    const times = getBookableSlots({
      ...base,
      staffWindows: weekdays([1], 13 * 60, 15 * 60),
    }).map((slot) => slot.time);
    expect(times[0]).toBe("13:00");
    expect(times[times.length - 1]).toBe("14:30");
  });

  it("no ofrece nada si el empleado no tiene horario ese día", () => {
    expect(getBookableSlots({ ...base, staffWindows: weekdays([2]) })).toEqual(
      [],
    );
  });

  it("excluye descansos, cierres y reservas con intervalos semiabiertos", () => {
    const times = getBookableSlots({
      ...base,
      blocked: [
        {
          start: new Date("2026-10-26T15:00:00.000Z"), // 10:00
          end: new Date("2026-10-26T16:00:00.000Z"), // 11:00
        },
      ],
    }).map((slot) => slot.time);

    expect(times).toContain("09:30"); // termina justo a las 10:00
    expect(times).not.toContain("09:45");
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("10:45");
    expect(times).toContain("11:00"); // empieza justo cuando termina el bloqueo
  });

  it("excluye horarios que ya pasaron el mismo día", () => {
    const times = getBookableSlots({
      ...base,
      now: new Date("2026-10-26T15:10:00.000Z"), // 10:10 en Bogotá
    }).map((slot) => slot.time);
    expect(times[0]).toBe("10:15");
  });

  it("devuelve una lista vacía con datos inválidos", () => {
    expect(getBookableSlots({ ...base, date: "2026-13-01" })).toEqual([]);
    expect(getBookableSlots({ ...base, durationMinutes: 0 })).toEqual([]);
  });

  it("no ofrece servicios que no caben antes del cierre", () => {
    const times = getBookableSlots({ ...base, durationMinutes: 120 }).map(
      (slot) => slot.time,
    );
    expect(times[times.length - 1]).toBe("16:00");
  });
});

describe("checkSlot", () => {
  const base = {
    timeZone: BOGOTA,
    startsAt: new Date("2026-10-26T15:00:00.000Z"), // lunes 10:00
    durationMinutes: 30,
    businessWindows: MON_TO_SAT,
    staffWindows: MON_TO_SAT,
    closures: [],
    timeOffs: [],
    now: NOW,
  };

  it("acepta un horario válido", () => {
    expect(checkSlot(base)).toEqual({ ok: true });
  });

  it("acepta una reserva que termina exactamente al cierre", () => {
    expect(
      checkSlot({ ...base, startsAt: new Date("2026-10-26T22:30:00.000Z") }),
    ).toEqual({ ok: true }); // 17:30 → 18:00
  });

  it("rechaza una reserva que termina después del cierre", () => {
    expect(
      checkSlot({ ...base, startsAt: new Date("2026-10-26T22:45:00.000Z") }),
    ).toEqual({ ok: false, reason: "OUTSIDE_BUSINESS_HOURS" });
  });

  it("rechaza horarios en el pasado", () => {
    expect(
      checkSlot({ ...base, now: new Date("2026-10-27T00:00:00.000Z") }),
    ).toEqual({ ok: false, reason: "PAST" });
  });

  it("rechaza horas con segundos o milisegundos", () => {
    expect(
      checkSlot({ ...base, startsAt: new Date("2026-10-26T15:00:30.000Z") }),
    ).toEqual({ ok: false, reason: "INVALID_START" });
  });

  it("distingue horario del negocio y horario del empleado", () => {
    expect(checkSlot({ ...base, businessWindows: weekdays([2]) })).toEqual({
      ok: false,
      reason: "OUTSIDE_BUSINESS_HOURS",
    });
    expect(checkSlot({ ...base, staffWindows: [] })).toEqual({
      ok: false,
      reason: "OUTSIDE_STAFF_AVAILABILITY",
    });
  });

  it("detecta cierres y ausencias que se solapan", () => {
    const interval = {
      start: new Date("2026-10-26T15:15:00.000Z"),
      end: new Date("2026-10-26T16:00:00.000Z"),
    };
    expect(checkSlot({ ...base, closures: [interval] })).toEqual({
      ok: false,
      reason: "BUSINESS_CLOSED",
    });
    expect(checkSlot({ ...base, timeOffs: [interval] })).toEqual({
      ok: false,
      reason: "STAFF_TIME_OFF",
    });
  });

  it("no considera ausencia un intervalo que termina justo al empezar la cita", () => {
    expect(
      checkSlot({
        ...base,
        timeOffs: [
          {
            start: new Date("2026-10-26T14:00:00.000Z"),
            end: new Date("2026-10-26T15:00:00.000Z"),
          },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("usa la fecha local del negocio, no la UTC, para elegir el día", () => {
    // 2026-10-27T03:00Z es lunes 22:00 en Bogotá: fuera de horario, no martes.
    expect(
      checkSlot({
        ...base,
        startsAt: new Date("2026-10-27T03:00:00.000Z"),
        businessWindows: weekdays([2]),
      }),
    ).toEqual({ ok: false, reason: "OUTSIDE_BUSINESS_HOURS" });
  });
});
