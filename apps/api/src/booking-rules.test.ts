import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATUSES,
  canTransition,
  decideNoticeRule,
  isActiveStatus,
  isManagerRole,
  noticeMinutes,
  parseReason,
  requiresStartedBooking,
  type BookingStatusName,
} from "./booking-rules.js";

const ALL: BookingStatusName[] = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
  "EXPIRED",
];

describe("estados de reserva", () => {
  it("solo PENDING y CONFIRMED ocupan el horario", () => {
    expect([...ACTIVE_STATUSES]).toEqual(["PENDING", "CONFIRMED"]);
    expect(ALL.filter(isActiveStatus)).toEqual(["PENDING", "CONFIRMED"]);
    expect(isActiveStatus("OTRO")).toBe(false);
  });

  it("tabla completa de transiciones permitidas", () => {
    const allowed: [BookingStatusName, BookingStatusName][] = [
      ["PENDING", "CONFIRMED"],
      ["PENDING", "CANCELLED"],
      ["PENDING", "EXPIRED"],
      ["CONFIRMED", "CANCELLED"],
      ["CONFIRMED", "COMPLETED"],
      ["CONFIRMED", "NO_SHOW"],
    ];
    for (const from of ALL) {
      for (const to of ALL) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("los estados finales son inmutables", () => {
    for (const final of [
      "CANCELLED",
      "COMPLETED",
      "NO_SHOW",
      "EXPIRED",
    ] as const) {
      for (const to of ALL) expect(canTransition(final, to)).toBe(false);
    }
  });

  it("completar o marcar inasistencia exige que la cita haya comenzado", () => {
    expect(requiresStartedBooking("COMPLETED")).toBe(true);
    expect(requiresStartedBooking("NO_SHOW")).toBe(true);
    expect(requiresStartedBooking("CONFIRMED")).toBe(false);
    expect(requiresStartedBooking("EXPIRED")).toBe(false);
  });
});

describe("noticeMinutes", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  it("cuenta minutos completos hacia abajo", () => {
    expect(noticeMinutes(new Date("2026-10-20T14:00:00.000Z"), now)).toBe(120);
    expect(noticeMinutes(new Date("2026-10-20T13:59:59.999Z"), now)).toBe(119);
  });
  it("es negativo si la cita ya comenzó", () => {
    expect(noticeMinutes(new Date("2026-10-20T11:59:00.000Z"), now)).toBe(-1);
    expect(noticeMinutes(new Date("2026-10-20T11:59:59.000Z"), now)).toBe(-1);
  });
});

describe("parseReason", () => {
  it("normaliza ausentes y vacíos a null", () => {
    expect(parseReason(undefined)).toEqual({ ok: true, value: null });
    expect(parseReason(null)).toEqual({ ok: true, value: null });
    expect(parseReason("   ")).toEqual({ ok: true, value: null });
  });
  it("recorta el texto y respeta el máximo de 500 caracteres", () => {
    expect(parseReason("  hola  ")).toEqual({ ok: true, value: "hola" });
    expect(parseReason("x".repeat(500)).ok).toBe(true);
    expect(parseReason("x".repeat(501)).ok).toBe(false);
  });
  it("rechaza valores que no son texto", () => {
    expect(parseReason(5).ok).toBe(false);
    expect(parseReason({}).ok).toBe(false);
  });
});

describe("isManagerRole", () => {
  it("OWNER y ADMIN gestionan; STAFF no", () => {
    expect(isManagerRole("OWNER")).toBe(true);
    expect(isManagerRole("ADMIN")).toBe(true);
    expect(isManagerRole("STAFF")).toBe(false);
  });
});

describe("decideNoticeRule", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const startsIn = (minutes: number) =>
    new Date(now.getTime() + minutes * 60_000);
  const base = {
    restriction: "CANCELLATION_NOTICE" as const,
    requiredMinutes: 120,
    now,
    role: "OWNER" as const,
    overrideRequested: false,
    reason: null as string | null,
  };

  it("sin política (0) o con aviso suficiente: ok", () => {
    expect(
      decideNoticeRule({ ...base, requiredMinutes: 0, startsAt: startsIn(1) })
        .kind,
    ).toBe("ok");
    expect(decideNoticeRule({ ...base, startsAt: startsIn(120) }).kind).toBe(
      "ok",
    );
    expect(decideNoticeRule({ ...base, startsAt: startsIn(5000) }).kind).toBe(
      "ok",
    );
  });

  it("una cita ya comenzada incumple cualquier aviso positivo", () => {
    const decision = decideNoticeRule({ ...base, startsAt: startsIn(-10) });
    expect(decision).toMatchObject({ kind: "blocked", actualMinutes: -10 });
  });

  it("sin aviso suficiente y sin override: bloqueado, informando si puede omitirse", () => {
    expect(decideNoticeRule({ ...base, startsAt: startsIn(119) })).toEqual({
      kind: "blocked",
      requiredMinutes: 120,
      actualMinutes: 119,
      canOverride: true,
    });
    expect(
      decideNoticeRule({ ...base, role: "STAFF", startsAt: startsIn(119) }),
    ).toMatchObject({ kind: "blocked", canOverride: false });
  });

  it("STAFF nunca puede omitir, ni con motivo", () => {
    expect(
      decideNoticeRule({
        ...base,
        role: "STAFF",
        overrideRequested: true,
        reason: "Motivo válido y largo",
        startsAt: startsIn(10),
      }).kind,
    ).toBe("override_forbidden");
  });

  it("OWNER/ADMIN necesitan motivo de al menos 5 caracteres", () => {
    for (const reason of [null, "", "abcd"]) {
      expect(
        decideNoticeRule({
          ...base,
          overrideRequested: true,
          reason,
          startsAt: startsIn(10),
        }).kind,
      ).toBe("reason_required");
    }
    expect(
      decideNoticeRule({
        ...base,
        role: "ADMIN",
        overrideRequested: true,
        reason: "abcde",
        startsAt: startsIn(10),
      }),
    ).toEqual({
      kind: "override",
      override: {
        restriction: "CANCELLATION_NOTICE",
        requiredMinutes: 120,
        actualMinutes: 10,
      },
    });
  });

  it("si el aviso se cumple, el override solicitado se ignora (no se registra)", () => {
    expect(
      decideNoticeRule({
        ...base,
        overrideRequested: true,
        reason: "Motivo válido",
        startsAt: startsIn(500),
      }).kind,
    ).toBe("ok");
  });

  it("conserva la restricción evaluada (modificación)", () => {
    const decision = decideNoticeRule({
      ...base,
      restriction: "RESCHEDULE_NOTICE",
      overrideRequested: true,
      reason: "Motivo válido",
      startsAt: startsIn(1),
    });
    expect(decision).toMatchObject({
      kind: "override",
      override: { restriction: "RESCHEDULE_NOTICE" },
    });
  });
});
