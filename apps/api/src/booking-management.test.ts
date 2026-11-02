import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `prismaMock` solo tiene lecturas de autorización. Las ESCRITURAS existen
// únicamente en `tx` (el cliente de la transacción): si el código escribiera
// fuera de la transacción, fallaría con "is not a function".
const { prismaMock, tx } = vi.hoisted(() => {
  const tx = {
    booking: { findFirst: vi.fn(), updateMany: vi.fn() },
    bookingEvent: { create: vi.fn() },
    service: { findFirst: vi.fn() },
    staff: { findFirst: vi.fn() },
    staffService: { findUnique: vi.fn() },
    businessHours: { findMany: vi.fn() },
    staffAvailability: { findMany: vi.fn() },
    businessClosure: { findMany: vi.fn() },
    timeOff: { findMany: vi.fn() },
  };
  const prismaMock = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    session: { findFirst: vi.fn() },
    membership: { findFirst: vi.fn() },
    booking: { findUnique: vi.fn() },
    staff: { findFirst: vi.fn() },
  };
  return { prismaMock, tx };
});

vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));

import { app } from "./app.js";

const BOOKING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUSINESS_ID = "758ad131-14b1-42e4-8d74-d093bb62c41b";
const STAFF_ID = "cd5e9781-0edf-45e0-9e4f-3a32aef9b681";
const OTHER_STAFF_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SERVICE_ID = "caa733de-3c1a-4679-b2ea-5d9a79e792cb";
const OTHER_SERVICE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COOKIE = `turnia_session=${"c".repeat(43)}`;

const NOW = new Date("2026-10-20T12:00:00.000Z");
// Lunes 2026-10-26 10:00 Bogotá = 15:00 UTC (30 minutos).
const START = new Date("2026-10-26T15:00:00.000Z");
const END = new Date("2026-10-26T15:30:00.000Z");
const MIN = 60_000;

type Role = "OWNER" | "ADMIN" | "STAFF";

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    status: "CONFIRMED",
    startsAt: START,
    endsAt: END,
    version: 3,
    serviceId: SERVICE_ID,
    staffId: STAFF_ID,
    serviceNameSnapshot: "Corte de cabello",
    durationMinutesSnapshot: 30,
    priceSnapshot: 25000,
    business: {
      timezone: "America/Bogota",
      cancellationNoticeMinutes: 0,
      rescheduleNoticeMinutes: 0,
    },
    ...overrides,
  };
}

/** Sesión válida + membresía con el rol indicado (STAFF queda vinculado). */
function loginAs(role: Role, options: { linkedStaffId?: string | null } = {}) {
  prismaMock.session.findFirst.mockResolvedValue({
    user: { id: "user-1", active: true },
  });
  prismaMock.booking.findUnique.mockResolvedValue({
    id: BOOKING_ID,
    businessId: BUSINESS_ID,
    staffId: STAFF_ID,
  });
  prismaMock.membership.findFirst.mockResolvedValue({
    id: "membership-1",
    role,
  });
  if (role === "STAFF") {
    const linked =
      options.linkedStaffId === undefined ? STAFF_ID : options.linkedStaffId;
    prismaMock.staff.findFirst.mockResolvedValue(
      linked ? { id: linked } : null,
    );
  }
}

function mockWorkingSchedule() {
  const windows = [1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    startMinute: 8 * 60,
    endMinute: 18 * 60,
  }));
  tx.businessHours.findMany.mockResolvedValue(windows);
  tx.staffAvailability.findMany.mockResolvedValue(windows);
  tx.businessClosure.findMany.mockResolvedValue([]);
  tx.timeOff.findMany.mockResolvedValue([]);
}

const summary = { id: BOOKING_ID, status: "CANCELLED", version: 4 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  prismaMock.$transaction.mockImplementation(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  tx.booking.findFirst.mockResolvedValue(bookingRow());
  tx.booking.updateMany.mockResolvedValue({ count: 1 });
  tx.bookingEvent.create.mockResolvedValue({ id: "event-1" });
  mockWorkingSchedule();
});

afterEach(() => {
  vi.useRealTimers();
});

const withCookie = (req: request.Test) => req.set("Cookie", COOKIE);
const cancel = (body: Record<string, unknown> = { expectedVersion: 3 }) =>
  withCookie(request(app).post(`/api/v1/bookings/${BOOKING_ID}/cancel`)).send(
    body,
  );
const patch = (body: Record<string, unknown>) =>
  withCookie(request(app).patch(`/api/v1/bookings/${BOOKING_ID}`)).send(body);
const changeStatus = (body: Record<string, unknown>) =>
  withCookie(request(app).post(`/api/v1/bookings/${BOOKING_ID}/status`)).send(
    body,
  );

// ---------------------------------------------------------------------------
describe("permisos de acceso a una reserva", () => {
  const endpoints: [string, () => request.Test][] = [
    ["GET detalle", () => request(app).get(`/api/v1/bookings/${BOOKING_ID}`)],
    [
      "POST cancelar",
      () =>
        request(app)
          .post(`/api/v1/bookings/${BOOKING_ID}/cancel`)
          .send({ expectedVersion: 3 }),
    ],
    [
      "PATCH modificar",
      () =>
        request(app)
          .patch(`/api/v1/bookings/${BOOKING_ID}`)
          .send({ expectedVersion: 3, startsAt: "2026-10-27T10:00:00-05:00" }),
    ],
    [
      "POST estado",
      () =>
        request(app)
          .post(`/api/v1/bookings/${BOOKING_ID}/status`)
          .send({ expectedVersion: 3, status: "NO_SHOW" }),
    ],
  ];

  it.each(endpoints)(
    "%s exige sesión (401) y no toca la base",
    async (_n, call) => {
      const response = await call();
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
      expect(prismaMock.booking.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it("rechaza identificadores que no son UUID (400)", async () => {
    const response = await request(app)
      .get("/api/v1/bookings/no-es-uuid")
      .set("Cookie", COOKIE);
    expect(response.status).toBe(400);
  });

  it("responde 404 si la reserva no existe", async () => {
    prismaMock.session.findFirst.mockResolvedValue({
      user: { id: "user-1", active: true },
    });
    prismaMock.booking.findUnique.mockResolvedValue(null);

    const response = await withCookie(
      request(app).get(`/api/v1/bookings/${BOOKING_ID}`),
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("aísla negocios: sin membresía en el negocio de la reserva responde 404", async () => {
    loginAs("OWNER");
    prismaMock.membership.findFirst.mockResolvedValue(null);

    const response = await cancel();

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("BOOKING_NOT_FOUND");
    // La membresía se busca en el negocio de la RESERVA, no en uno enviado
    // por el cliente.
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith({
      where: { businessId: BUSINESS_ID, userId: "user-1" },
      select: { id: true, role: true },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("STAFF no puede acceder a la reserva de otro empleado (404)", async () => {
    loginAs("STAFF", { linkedStaffId: OTHER_STAFF_ID });
    const response = await cancel();
    expect(response.status).toBe(404);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("STAFF sin empleado vinculado no accede a ninguna reserva (404)", async () => {
    loginAs("STAFF", { linkedStaffId: null });
    const response = await cancel();
    expect(response.status).toBe(404);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("STAFF accede a una reserva asignada a su empleado", async () => {
    loginAs("STAFF");
    prismaMock.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      businessId: BUSINESS_ID,
      staffId: STAFF_ID,
    });
    const response = await cancel();
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("GET /bookings/:id (detalle e historial)", () => {
  const detail = (events: unknown[]) => ({
    ...bookingRow(),
    events,
  });

  it("indica que el historial existe solo desde la Etapa 2 si no hay evento CREATED", async () => {
    loginAs("OWNER");
    (prismaMock.booking as Record<string, unknown>).findFirst = vi
      .fn()
      .mockResolvedValue(detail([]));

    const response = await withCookie(
      request(app).get(`/api/v1/bookings/${BOOKING_ID}`),
    );

    expect(response.status).toBe(200);
    expect(response.body.data.historyAvailableFromStage2).toBe(true);
    expect(response.body.data.events).toEqual([]);
    expect(response.body.data.permissions).toEqual({
      canOverrideNotice: true,
      canChangeStaff: true,
    });
  });

  it("con evento CREATED el historial es completo y STAFF no puede omitir avisos", async () => {
    loginAs("STAFF");
    (prismaMock.booking as Record<string, unknown>).findFirst = vi
      .fn()
      .mockResolvedValue(
        detail([
          {
            id: "e1",
            type: "CREATED",
            actorType: "USER",
            fromStatus: null,
            toStatus: "CONFIRMED",
            reason: null,
            data: {},
            createdAt: NOW,
            actorUser: { fullName: "Ana" },
          },
        ]),
      );

    const response = await withCookie(
      request(app).get(`/api/v1/bookings/${BOOKING_ID}`),
    );

    expect(response.body.data.historyAvailableFromStage2).toBe(false);
    expect(response.body.data.permissions).toEqual({
      canOverrideNotice: false,
      canChangeStaff: false,
    });
  });
});

// ---------------------------------------------------------------------------
describe("POST /bookings/:id/cancel", () => {
  beforeEach(() => {
    loginAs("OWNER");
    tx.booking.findFirst
      .mockResolvedValueOnce(bookingRow())
      .mockResolvedValueOnce(summary);
  });

  it.each([
    ["sin expectedVersion", {}],
    ["expectedVersion no entero", { expectedVersion: 1.5 }],
    ["expectedVersion cero", { expectedVersion: 0 }],
    ["motivo demasiado largo", { expectedVersion: 3, reason: "x".repeat(501) }],
    ["motivo que no es texto", { expectedVersion: 3, reason: 42 }],
    ["override que no es booleano", { expectedVersion: 3, override: "si" }],
  ])("valida el cuerpo: %s", async (_name, body) => {
    const response = await cancel(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("cancela y guarda cambio + evento con el cliente de la transacción", async () => {
    const response = await cancel({
      expectedVersion: 3,
      reason: "  El cliente avisó  ",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("CANCELLED");

    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: BOOKING_ID,
        businessId: BUSINESS_ID,
        version: 3,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: {
        status: "CANCELLED",
        cancelledAt: NOW,
        cancelReason: "El cliente avisó",
        cancelledByUserId: "user-1",
        version: { increment: 1 },
      },
    });
    expect(tx.bookingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: BUSINESS_ID,
        bookingId: BOOKING_ID,
        type: "CANCELLED",
        actorType: "USER",
        actorUserId: "user-1",
        fromStatus: "CONFIRMED",
        toStatus: "CANCELLED",
        reason: "El cliente avisó",
      }),
    });
    // Sin excepción de aviso no se registra "override".
    const event = tx.bookingEvent.create.mock.calls[0]![0].data;
    expect(event.data.override).toBeUndefined();
  });

  it("detecta una versión desactualizada (409) sin escribir nada", async () => {
    tx.booking.findFirst.mockReset();
    tx.booking.findFirst.mockResolvedValue(bookingRow({ version: 7 }));

    const response = await cancel({ expectedVersion: 3 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STALE_BOOKING");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.bookingEvent.create).not.toHaveBeenCalled();
  });

  it("si otra operación se adelantó (0 filas) responde 409 y NO registra el evento", async () => {
    tx.booking.updateMany.mockResolvedValue({ count: 0 });

    const response = await cancel();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STALE_BOOKING");
    expect(tx.bookingEvent.create).not.toHaveBeenCalled();
  });

  it.each(["CANCELLED", "COMPLETED", "NO_SHOW", "EXPIRED"])(
    "no permite cancelar una reserva en estado final %s",
    async (status) => {
      tx.booking.findFirst.mockReset();
      tx.booking.findFirst.mockResolvedValue(bookingRow({ status }));

      const response = await cancel();

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("INVALID_STATE");
      expect(response.body.error.details.status).toBe(status);
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    },
  );

  it("permite cancelar una reserva PENDING", async () => {
    tx.booking.findFirst.mockReset();
    tx.booking.findFirst
      .mockResolvedValueOnce(bookingRow({ status: "PENDING" }))
      .mockResolvedValueOnce(summary);
    const response = await cancel();
    expect(response.status).toBe(200);
    expect(tx.bookingEvent.create.mock.calls[0]![0].data.fromStatus).toBe(
      "PENDING",
    );
  });

  it("no cancela una reserva que ya terminó (422)", async () => {
    vi.setSystemTime(new Date("2026-10-26T16:00:00.000Z"));
    const response = await cancel();
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("BOOKING_ALREADY_ENDED");
  });

  it("si falla el evento de auditoría, la operación falla (500) y la transacción se revierte", async () => {
    tx.bookingEvent.create.mockRejectedValue(new Error("fallo de auditoría"));

    const response = await cancel();

    expect(response.status).toBe(500);
    expect(response.body.data).toBeUndefined();
    // El cambio se intentó DENTRO de la transacción que ahora rechaza.
    expect(tx.booking.updateMany).toHaveBeenCalledTimes(1);
  });

  describe("aviso mínimo de cancelación", () => {
    const withNotice = (minutes: number, startsInMinutes: number) => {
      const startsAt = new Date(NOW.getTime() + startsInMinutes * MIN);
      tx.booking.findFirst.mockReset();
      tx.booking.findFirst
        .mockResolvedValueOnce(
          bookingRow({
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * MIN),
            business: {
              timezone: "America/Bogota",
              cancellationNoticeMinutes: minutes,
              rescheduleNoticeMinutes: 0,
            },
          }),
        )
        .mockResolvedValueOnce(summary);
    };

    it("exactamente el aviso exigido es válido (límite inclusivo)", async () => {
      withNotice(120, 120);
      expect((await cancel()).status).toBe(200);
    });

    it("un minuto menos del aviso exigido se bloquea", async () => {
      withNotice(120, 119);
      const response = await cancel();
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("NOTICE_REQUIRED");
      expect(response.body.error.details).toEqual({
        restriction: "CANCELLATION_NOTICE",
        requiredMinutes: 120,
        actualMinutes: 119,
        canOverride: true,
      });
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it("con aviso 0 (sin política) no restringe", async () => {
      withNotice(0, 5);
      expect((await cancel()).status).toBe(200);
    });

    it("STAFF no puede omitir el aviso: se informa canOverride=false", async () => {
      loginAs("STAFF");
      withNotice(120, 60);
      const response = await cancel();
      expect(response.status).toBe(422);
      expect(response.body.error.details.canOverride).toBe(false);
    });

    it("STAFF que intenta omitir el aviso recibe 403", async () => {
      loginAs("STAFF");
      withNotice(120, 60);
      const response = await cancel({
        expectedVersion: 3,
        override: true,
        reason: "Lo autorizo yo mismo",
      });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("OVERRIDE_NOT_ALLOWED");
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ["sin motivo", undefined],
      ["motivo vacío", "   "],
      ["motivo demasiado corto", "ok"],
    ])("OWNER no puede omitir el aviso %s (400)", async (_n, reason) => {
      withNotice(120, 60);
      const response = await cancel({
        expectedVersion: 3,
        override: true,
        ...(reason !== undefined ? { reason } : {}),
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("REASON_REQUIRED");
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it.each(["OWNER", "ADMIN"] as const)(
      "%s omite el aviso con motivo y queda registrado quién y qué restricción",
      async (role) => {
        loginAs(role);
        withNotice(120, 60);

        const response = await cancel({
          expectedVersion: 3,
          override: true,
          reason: "Emergencia del cliente, autorizado por gerencia",
        });

        expect(response.status).toBe(200);
        const event = tx.bookingEvent.create.mock.calls[0]![0].data;
        expect(event.reason).toBe(
          "Emergencia del cliente, autorizado por gerencia",
        );
        expect(event.actorUserId).toBe("user-1");
        expect(event.data.override).toEqual({
          restriction: "CANCELLATION_NOTICE",
          requiredMinutes: 120,
          actualMinutes: 60,
          authorizedByUserId: "user-1",
        });
      },
    );

    it("no registra una excepción que no hizo falta", async () => {
      withNotice(120, 600);
      const response = await cancel({
        expectedVersion: 3,
        override: true,
        reason: "Por si acaso",
      });
      expect(response.status).toBe(200);
      expect(
        tx.bookingEvent.create.mock.calls[0]![0].data.data.override,
      ).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
describe("PATCH /bookings/:id (modificar)", () => {
  const NEW_START = "2026-10-27T10:00:00-05:00"; // martes 10:00 Bogotá
  const NEW_START_UTC = new Date("2026-10-27T15:00:00.000Z");

  beforeEach(() => {
    loginAs("OWNER");
    tx.booking.findFirst
      .mockResolvedValueOnce(bookingRow())
      .mockResolvedValueOnce({ ...summary, status: "CONFIRMED" });
    tx.service.findFirst.mockResolvedValue({
      id: SERVICE_ID,
      name: "Corte de cabello",
      durationMinutes: 30,
      price: 25000,
    });
    tx.staff.findFirst.mockResolvedValue({ id: STAFF_ID });
    tx.staffService.findUnique.mockResolvedValue({ businessId: BUSINESS_ID });
  });

  it.each([
    ["sin ningún cambio", { expectedVersion: 3 }],
    ["sin expectedVersion", { startsAt: NEW_START }],
    ["startsAt sin hora", { expectedVersion: 3, startsAt: "2026-10-27" }],
    [
      "startsAt inválido",
      { expectedVersion: 3, startsAt: "2026-13-45T10:00:00" },
    ],
    ["serviceId no UUID", { expectedVersion: 3, serviceId: "x" }],
    ["staffId no UUID", { expectedVersion: 3, staffId: 5 }],
  ])("valida el cuerpo: %s", async (_n, body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("reprograma, recalcula el fin y guarda cambio + evento antes/después", async () => {
    const response = await patch({
      expectedVersion: 3,
      startsAt: NEW_START,
      reason: "A pedido del cliente",
    });

    expect(response.status).toBe(200);
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: BOOKING_ID,
        businessId: BUSINESS_ID,
        version: 3,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: {
        startsAt: NEW_START_UTC,
        endsAt: new Date("2026-10-27T15:30:00.000Z"),
        serviceId: SERVICE_ID,
        staffId: STAFF_ID,
        version: { increment: 1 },
      },
    });
    const event = tx.bookingEvent.create.mock.calls[0]![0].data;
    expect(event.type).toBe("MODIFIED");
    expect(event.reason).toBe("A pedido del cliente");
    expect(event.fromStatus).toBe("CONFIRMED");
    expect(event.toStatus).toBe("CONFIRMED");
    expect(event.data.before.startsAt).toBe(START.toISOString());
    expect(event.data.after.startsAt).toBe(NEW_START_UTC.toISOString());
    expect(event.data.override).toBeUndefined();
  });

  it("al cambiar de servicio actualiza nombre, duración y precio y recalcula el fin", async () => {
    tx.service.findFirst.mockResolvedValue({
      id: OTHER_SERVICE_ID,
      name: "Tinte",
      durationMinutes: 90,
      price: 120000,
    });

    const response = await patch({
      expectedVersion: 3,
      serviceId: OTHER_SERVICE_ID,
    });

    expect(response.status).toBe(200);
    const update = tx.booking.updateMany.mock.calls[0]![0].data;
    expect(update).toMatchObject({
      serviceId: OTHER_SERVICE_ID,
      serviceNameSnapshot: "Tinte",
      durationMinutesSnapshot: 90,
      priceSnapshot: 120000,
      endsAt: new Date("2026-10-26T16:30:00.000Z"),
    });
    const event = tx.bookingEvent.create.mock.calls[0]![0].data;
    expect(event.data.before.serviceName).toBe("Corte de cabello");
    expect(event.data.after.serviceName).toBe("Tinte");
    expect(event.data.after.price).toBe("120000");
  });

  it("sin cambiar de servicio conserva la duración acordada (no la actual del servicio)", async () => {
    tx.service.findFirst.mockResolvedValue({
      id: SERVICE_ID,
      name: "Corte de cabello",
      durationMinutes: 45, // el servicio cambió de duración después de reservar
      price: 30000,
    });
    const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
    expect(response.status).toBe(200);
    const update = tx.booking.updateMany.mock.calls[0]![0].data;
    expect(update.endsAt).toEqual(new Date("2026-10-27T15:30:00.000Z"));
    expect(update.durationMinutesSnapshot).toBeUndefined();
  });

  it("rechaza una modificación idéntica a los datos actuales", async () => {
    const response = await patch({
      expectedVersion: 3,
      startsAt: START.toISOString(),
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("NO_CHANGES");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("OWNER/ADMIN pueden reasignar la reserva a otro empleado", async () => {
    tx.staff.findFirst.mockResolvedValue({ id: OTHER_STAFF_ID });
    const response = await patch({
      expectedVersion: 3,
      staffId: OTHER_STAFF_ID,
    });
    expect(response.status).toBe(200);
    expect(tx.booking.updateMany.mock.calls[0]![0].data.staffId).toBe(
      OTHER_STAFF_ID,
    );
  });

  it("STAFF no puede reasignar la reserva a otro empleado (403)", async () => {
    loginAs("STAFF");
    const response = await patch({
      expectedVersion: 3,
      staffId: OTHER_STAFF_ID,
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("STAFF_CHANGE_NOT_ALLOWED");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("STAFF sí puede reprogramar su propia reserva", async () => {
    loginAs("STAFF");
    const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
    expect(response.status).toBe(200);
  });

  it("un choque con otra reserva (violación de exclusión) responde 409 y no registra evento", async () => {
    tx.booking.updateMany.mockRejectedValue(
      Object.assign(
        new Error(
          'conflicting key value violates exclusion constraint "booking_staff_no_overlapping_active"',
        ),
        { code: "P2010" },
      ),
    );

    const response = await patch({ expectedVersion: 3, startsAt: NEW_START });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BOOKING_CONFLICT");
    expect(tx.bookingEvent.create).not.toHaveBeenCalled();
  });

  it("una versión desactualizada responde 409 STALE_BOOKING", async () => {
    tx.booking.findFirst.mockReset();
    tx.booking.findFirst.mockResolvedValue(bookingRow({ version: 9 }));
    const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STALE_BOOKING");
  });

  it("modificaciones simultáneas: la que llega segunda (0 filas) recibe 409 y no deja evento", async () => {
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STALE_BOOKING");
    expect(tx.bookingEvent.create).not.toHaveBeenCalled();
  });

  it("si falla el evento de auditoría, la modificación falla (500)", async () => {
    tx.bookingEvent.create.mockRejectedValue(new Error("fallo de auditoría"));
    const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
    expect(response.status).toBe(500);
  });

  it.each(["CANCELLED", "COMPLETED", "NO_SHOW", "EXPIRED"])(
    "no modifica una reserva en estado final %s",
    async (status) => {
      tx.booking.findFirst.mockReset();
      tx.booking.findFirst.mockResolvedValue(bookingRow({ status }));
      const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("INVALID_STATE");
    },
  );

  it("no modifica una reserva que ya comenzó (422)", async () => {
    vi.setSystemTime(new Date("2026-10-26T15:10:00.000Z"));
    const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("BOOKING_ALREADY_STARTED");
  });

  it.each([
    [
      "fuera del horario del negocio",
      "2026-10-27T19:00:00-05:00",
      "OUTSIDE_BUSINESS_HOURS",
    ],
    [
      "en domingo (sin atención)",
      "2026-10-25T10:00:00-05:00",
      "OUTSIDE_BUSINESS_HOURS",
    ],
    ["en el pasado", "2026-10-19T10:00:00-05:00", "PAST"],
  ])("rechaza un nuevo horario %s (422)", async (_n, startsAt, reason) => {
    const response = await patch({ expectedVersion: 3, startsAt });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("SLOT_UNAVAILABLE");
    expect(response.body.error.details.reason).toBe(reason);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rechaza un horario dentro de una ausencia del empleado", async () => {
    tx.timeOff.findMany.mockResolvedValue([
      {
        startsAt: new Date("2026-10-27T14:00:00.000Z"),
        endsAt: new Date("2026-10-27T16:00:00.000Z"),
      },
    ]);
    const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
    expect(response.status).toBe(422);
    expect(response.body.error.details.reason).toBe("STAFF_TIME_OFF");
  });

  it("rechaza si el empleado no realiza el servicio elegido", async () => {
    tx.staffService.findUnique.mockResolvedValue(null);
    const response = await patch({
      expectedVersion: 3,
      serviceId: OTHER_SERVICE_ID,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_BOOKING_REFERENCE");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rechaza servicio o empleado inexistente o inactivo", async () => {
    tx.staff.findFirst.mockResolvedValue(null);
    const response = await patch({
      expectedVersion: 3,
      staffId: OTHER_STAFF_ID,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_BOOKING_REFERENCE");
  });

  describe("aviso mínimo de modificación", () => {
    const withNotice = (minutes: number, startsInMinutes: number) => {
      const startsAt = new Date(NOW.getTime() + startsInMinutes * MIN);
      tx.booking.findFirst.mockReset();
      tx.booking.findFirst
        .mockResolvedValueOnce(
          bookingRow({
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * MIN),
            business: {
              timezone: "America/Bogota",
              cancellationNoticeMinutes: 0,
              rescheduleNoticeMinutes: minutes,
            },
          }),
        )
        .mockResolvedValueOnce({ ...summary, status: "CONFIRMED" });
    };

    it("bloquea la modificación sin el aviso exigido", async () => {
      withNotice(1440, 60);
      const response = await patch({ expectedVersion: 3, startsAt: NEW_START });
      expect(response.status).toBe(422);
      expect(response.body.error.details).toMatchObject({
        restriction: "RESCHEDULE_NOTICE",
        requiredMinutes: 1440,
        actualMinutes: 60,
        canOverride: true,
      });
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it("STAFF no puede omitirlo", async () => {
      loginAs("STAFF");
      withNotice(1440, 60);
      const response = await patch({
        expectedVersion: 3,
        startsAt: NEW_START,
        override: true,
        reason: "Yo lo autorizo",
      });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("OVERRIDE_NOT_ALLOWED");
    });

    it("ADMIN lo omite con motivo y se registra la restricción RESCHEDULE_NOTICE", async () => {
      loginAs("ADMIN");
      withNotice(1440, 60);
      const response = await patch({
        expectedVersion: 3,
        startsAt: NEW_START,
        override: true,
        reason: "Cliente con urgencia médica",
      });
      expect(response.status).toBe(200);
      const event = tx.bookingEvent.create.mock.calls[0]![0].data;
      expect(event.data.override).toEqual({
        restriction: "RESCHEDULE_NOTICE",
        requiredMinutes: 1440,
        actualMinutes: 60,
        authorizedByUserId: "user-1",
      });
    });

    it("omitir sin motivo es un error 400", async () => {
      withNotice(1440, 60);
      const response = await patch({
        expectedVersion: 3,
        startsAt: NEW_START,
        override: true,
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("REASON_REQUIRED");
    });
  });
});

// ---------------------------------------------------------------------------
describe("POST /bookings/:id/status", () => {
  beforeEach(() => {
    loginAs("OWNER");
  });

  const mockBooking = (status: string, startsAt = START) => {
    tx.booking.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: BOOKING_ID, status, startsAt, version: 3 })
      .mockResolvedValueOnce({ ...summary, status: "CONFIRMED" });
  };

  it("cancelar no se permite por aquí (debe usar /cancel con sus reglas)", async () => {
    const response = await changeStatus({
      expectedVersion: 3,
      status: "CANCELLED",
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("USE_CANCEL_ENDPOINT");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["estado desconocido", { expectedVersion: 3, status: "BORRADA" }],
    ["sin estado", { expectedVersion: 3 }],
    ["sin versión", { status: "CONFIRMED" }],
  ])("valida el cuerpo: %s", async (_n, body) => {
    const response = await changeStatus(body);
    expect(response.status).toBe(400);
  });

  it("confirma una reserva PENDING y registra el cambio de estado", async () => {
    mockBooking("PENDING");
    const response = await changeStatus({
      expectedVersion: 3,
      status: "CONFIRMED",
    });
    expect(response.status).toBe(200);
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: BOOKING_ID,
        businessId: BUSINESS_ID,
        version: 3,
        status: "PENDING",
      },
      data: {
        status: "CONFIRMED",
        version: { increment: 1 },
        confirmedAt: NOW,
        holdExpiresAt: null,
      },
    });
    expect(tx.bookingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "STATUS_CHANGED",
        fromStatus: "PENDING",
        toStatus: "CONFIRMED",
        actorUserId: "user-1",
      }),
    });
  });

  it.each(["COMPLETED", "NO_SHOW"])(
    "no permite marcar %s antes de la hora de la cita (422)",
    async (status) => {
      mockBooking("CONFIRMED");
      const response = await changeStatus({ expectedVersion: 3, status });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("BOOKING_NOT_STARTED");
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each(["COMPLETED", "NO_SHOW"])(
    "permite marcar %s después del inicio",
    async (status) => {
      vi.setSystemTime(new Date("2026-10-26T16:00:00.000Z"));
      mockBooking("CONFIRMED");
      const response = await changeStatus({ expectedVersion: 3, status });
      expect(response.status).toBe(200);
      expect(tx.bookingEvent.create.mock.calls[0]![0].data.toStatus).toBe(
        status,
      );
    },
  );

  it.each([
    ["CANCELLED", "CONFIRMED"],
    ["COMPLETED", "NO_SHOW"],
    ["NO_SHOW", "COMPLETED"],
    ["EXPIRED", "CONFIRMED"],
    ["CONFIRMED", "EXPIRED"],
    ["PENDING", "COMPLETED"],
  ])("transición no permitida %s → %s (409)", async (from, to) => {
    vi.setSystemTime(new Date("2026-10-26T16:00:00.000Z"));
    mockBooking(from);
    const response = await changeStatus({ expectedVersion: 3, status: to });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_STATE");
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("versión desactualizada → 409", async () => {
    tx.booking.findFirst.mockReset().mockResolvedValue({
      id: BOOKING_ID,
      status: "PENDING",
      startsAt: START,
      version: 8,
    });
    const response = await changeStatus({
      expectedVersion: 3,
      status: "CONFIRMED",
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STALE_BOOKING");
  });

  it("cambio simultáneo (0 filas) → 409 y sin evento", async () => {
    mockBooking("PENDING");
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    const response = await changeStatus({
      expectedVersion: 3,
      status: "CONFIRMED",
    });
    expect(response.status).toBe(409);
    expect(tx.bookingEvent.create).not.toHaveBeenCalled();
  });
});
