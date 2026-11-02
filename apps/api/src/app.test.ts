import express from "express";
import request from "supertest";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSessionToken } from "./auth.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    session: { findFirst: vi.fn() },
    membership: { findFirst: vi.fn() },
    booking: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    bookingEvent: { create: vi.fn() },
    business: {
      findFirst: vi.fn(),
    },
    service: {
      findFirst: vi.fn(),
    },
    staff: {
      findFirst: vi.fn(),
    },
    staffService: {
      findUnique: vi.fn(),
    },
    businessHours: { findMany: vi.fn() },
    staffAvailability: { findMany: vi.fn() },
    businessClosure: { findMany: vi.fn() },
    timeOff: { findMany: vi.fn() },
    customer: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("./lib/prisma.js", () => ({
  prisma: prismaMock,
}));

import { app, errorHandler } from "./app.js";

describe("GET /api/v1/health", () => {
  it("responde que la API está disponible", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("respuestas de error", () => {
  it("responde JSON consistente para rutas inexistentes", async () => {
    const response = await request(app).get("/api/v1/no-existe");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "Ruta no encontrada" },
    });
  });

  it("responde JSON sin trazas para JSON malformado", async () => {
    const response = await request(app)
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });

  it("oculta detalles de errores internos en producción", async () => {
    const productionApp = express();
    productionApp.get("/failure", (_request, _response, next) => {
      next(new Error("detalle interno confidencial"));
    });
    productionApp.use(errorHandler);

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const response = await request(productionApp).get("/failure");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Error interno del servidor",
        },
      });
      expect(JSON.stringify(response.body)).not.toContain("confidencial");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });
});

describe("POST /api/v1/bookings: validaciones", () => {
  it("rechaza un cuerpo vacío sin consultar la base de datos", async () => {
    const response = await request(app).post("/api/v1/bookings").send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(response.body.error.message).toContain("businessId");
  });

  it("rechaza identificadores que no son UUID válidos", async () => {
    const response = await request(app).post("/api/v1/bookings").send({
      businessId: "no-es-un-uuid",
      serviceId: "caa733de-3c1a-4679-b2ea-5d9a79e792cb",
      staffId: "cd5e9781-0edf-45e0-9e4f-3a32aef9b681",
      startsAt: "2026-10-25T10:00:00-05:00",
      name: "Cliente de prueba",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("rechaza un correo electrónico con formato inválido", async () => {
    const response = await request(app).post("/api/v1/bookings").send({
      businessId: "758ad131-14b1-42e4-8d74-d093bb62c41b",
      serviceId: "caa733de-3c1a-4679-b2ea-5d9a79e792cb",
      staffId: "cd5e9781-0edf-45e0-9e4f-3a32aef9b681",
      startsAt: "2026-10-25T10:00:00-05:00",
      name: "Cliente de prueba",
      email: "correo-invalido",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(response.body.error.message).toContain("correo");
  });
});

describe("GET /api/v1/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const businessId = "758ad131-14b1-42e4-8d74-d093bb62c41b";
  const token = "a".repeat(43);

  function mockValidSession() {
    prismaMock.session.findFirst.mockResolvedValue({
      user: {
        id: "user-1",
        active: true,
      },
    });
  }

  it("rechaza solicitudes sin sesión", async () => {
    const response = await request(app).get(
      `/api/v1/bookings?businessId=${businessId}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
    expect(prismaMock.membership.findFirst).not.toHaveBeenCalled();
  });

  it("rechaza usuarios sin membresía en el negocio", async () => {
    mockValidSession();
    prismaMock.membership.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/v1/bookings?businessId=${businessId}`)
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith({
      where: { businessId, userId: "user-1" },
      select: { id: true, role: true },
    });
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
  });

  it("lista las reservas solo para un usuario autorizado", async () => {
    mockValidSession();
    prismaMock.membership.findFirst.mockResolvedValue({
      id: "membership-1",
      role: "OWNER",
    });

    const bookings = [
      {
        id: "booking-1",
        status: "CONFIRMED",
        source: "PANEL",
        customerNameSnapshot: "Cliente de prueba",
        customerEmailSnapshot: "cliente@example.com",
        customerPhoneSnapshot: "3001234567",
        serviceNameSnapshot: "Corte de cabello",
        durationMinutesSnapshot: 30,
        priceSnapshot: 25000,
        startsAt: new Date("2026-10-25T15:00:00.000Z"),
        endsAt: new Date("2026-10-25T15:30:00.000Z"),
        notes: null,
        createdAt: new Date("2026-10-20T12:00:00.000Z"),
      },
    ];

    prismaMock.booking.findMany.mockResolvedValue(bookings);

    const response = await request(app)
      .get(`/api/v1/bookings?businessId=${businessId}`)
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe("booking-1");

    expect(prismaMock.session.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: hashSessionToken(token),
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: {
        user: {
          select: { id: true, active: true },
        },
      },
    });

    expect(prismaMock.booking.findMany).toHaveBeenCalledWith({
      where: { businessId },
      orderBy: { startsAt: "asc" },
      select: expect.any(Object),
    });
    expect(response.body.meta).toEqual({ scope: "ALL", role: "OWNER" });
    // OWNER no necesita resolver ningún empleado vinculado.
    expect(prismaMock.staff.findFirst).not.toHaveBeenCalled();
  });

  it("ADMIN también ve todas las reservas del negocio", async () => {
    mockValidSession();
    prismaMock.membership.findFirst.mockResolvedValue({
      id: "membership-2",
      role: "ADMIN",
    });
    prismaMock.booking.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get(`/api/v1/bookings?businessId=${businessId}`)
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.meta.scope).toBe("ALL");
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId } }),
    );
  });

  it("STAFF vinculado solo ve las reservas de su empleado", async () => {
    mockValidSession();
    prismaMock.membership.findFirst.mockResolvedValue({
      id: "membership-3",
      role: "STAFF",
    });
    prismaMock.staff.findFirst.mockResolvedValue({ id: "staff-propio" });
    prismaMock.booking.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get(`/api/v1/bookings?businessId=${businessId}`)
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({
      scope: "OWN",
      role: "STAFF",
      staffId: "staff-propio",
    });
    expect(prismaMock.staff.findFirst).toHaveBeenCalledWith({
      where: { businessId, userId: "user-1", active: true },
      select: { id: true },
    });
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId, staffId: "staff-propio" },
      }),
    );
  });

  it("STAFF sin empleado vinculado no obtiene ninguna reserva", async () => {
    mockValidSession();
    prismaMock.membership.findFirst.mockResolvedValue({
      id: "membership-3",
      role: "STAFF",
    });
    prismaMock.staff.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/v1/bookings?businessId=${businessId}`)
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.scope).toBe("UNLINKED");
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
  });

  it("un rol desconocido falla cerrado: no obtiene reservas", async () => {
    mockValidSession();
    prismaMock.membership.findFirst.mockResolvedValue({ id: "membership-4" });
    prismaMock.staff.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/v1/bookings?businessId=${businessId}`)
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
  });

  it("rechaza un businessId inválido", async () => {
    const response = await request(app).get(
      "/api/v1/bookings?businessId=no-es-un-uuid",
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
  });
});

const BUSINESS_ID = "758ad131-14b1-42e4-8d74-d093bb62c41b";
const SERVICE_ID = "caa733de-3c1a-4679-b2ea-5d9a79e792cb";
const STAFF_ID = "cd5e9781-0edf-45e0-9e4f-3a32aef9b681";
const SESSION_TOKEN = "b".repeat(43);

// Lunes 2026-10-26, 10:00 en Bogotá (UTC-5) = 15:00 UTC.
const MONDAY_10AM = "2026-10-26T10:00:00-05:00";
const MONDAY_10AM_UTC = new Date("2026-10-26T15:00:00.000Z");
const MONDAY_1030AM_UTC = new Date("2026-10-26T15:30:00.000Z");

const bookingPayload = (overrides: Record<string, unknown> = {}) => ({
  businessId: BUSINESS_ID,
  serviceId: SERVICE_ID,
  staffId: STAFF_ID,
  startsAt: MONDAY_10AM,
  name: "Cliente de prueba",
  email: "cliente@example.com",
  phone: "3001234567",
  ...overrides,
});

function mockAuthorizedPanelUser() {
  prismaMock.session.findFirst.mockResolvedValue({
    user: { id: "user-1", active: true },
  });
  prismaMock.membership.findFirst.mockResolvedValue({
    id: "membership-1",
    role: "OWNER",
  });
}

function mockBusinessSchedule() {
  // Lunes (1) a sábado (6), 08:00 a 18:00.
  const windows = [1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    startMinute: 8 * 60,
    endMinute: 18 * 60,
  }));
  prismaMock.businessHours.findMany.mockResolvedValue(windows);
  prismaMock.staffAvailability.findMany.mockResolvedValue(windows);
  prismaMock.businessClosure.findMany.mockResolvedValue([]);
  prismaMock.timeOff.findMany.mockResolvedValue([]);
}

describe("POST /api/v1/bookings: autorización, agenda y creación", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Solo se simula Date; los temporizadores reales siguen funcionando.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
        callback(prismaMock),
    );

    mockAuthorizedPanelUser();
    mockBusinessSchedule();

    prismaMock.business.findFirst.mockResolvedValue({
      id: BUSINESS_ID,
      bookingHoldMinutes: 1440,
      timezone: "America/Bogota",
    });

    prismaMock.service.findFirst.mockResolvedValue({
      id: SERVICE_ID,
      businessId: BUSINESS_ID,
      name: "Corte de cabello",
      durationMinutes: 30,
      price: 25000,
      active: true,
    });

    prismaMock.staff.findFirst.mockResolvedValue({
      id: STAFF_ID,
      businessId: BUSINESS_ID,
      displayName: "Empleado Demo",
      active: true,
    });

    prismaMock.staffService.findUnique.mockResolvedValue({
      businessId: BUSINESS_ID,
      staffId: STAFF_ID,
      serviceId: SERVICE_ID,
    });

    prismaMock.customer.findFirst.mockResolvedValue(null);
    prismaMock.customer.create.mockResolvedValue({
      id: "customer-simulado",
      name: "Cliente de prueba",
      email: "cliente@example.com",
      phone: "3001234567",
    });

    prismaMock.bookingEvent.create.mockResolvedValue({ id: "event-1" });

    prismaMock.booking.create.mockResolvedValue({
      id: "booking-simulado",
      businessId: BUSINESS_ID,
      customerId: "customer-simulado",
      serviceId: SERVICE_ID,
      staffId: STAFF_ID,
      status: "CONFIRMED",
      customerNameSnapshot: "Cliente de prueba",
      serviceNameSnapshot: "Corte de cabello",
      durationMinutesSnapshot: 30,
      priceSnapshot: 25000,
      startsAt: MONDAY_10AM_UTC,
      endsAt: MONDAY_1030AM_UTC,
      notes: null,
      createdAt: new Date("2026-10-20T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const post = (body: Record<string, unknown> = bookingPayload()) =>
    request(app)
      .post("/api/v1/bookings")
      .set("Cookie", `turnia_session=${SESSION_TOKEN}`)
      .send(body);

  it("rechaza crear una reserva sin sesión y no toca la base de datos", async () => {
    const response = await request(app)
      .post("/api/v1/bookings")
      .send(bookingPayload());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  it("rechaza crear una reserva si el usuario no pertenece al negocio", async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null);

    const response = await post();

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith({
      where: { businessId: BUSINESS_ID, userId: "user-1" },
      select: { id: true, role: true },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  it("rechaza una reserva cuando existe un conflicto de horario", async () => {
    prismaMock.$transaction.mockRejectedValue(
      Object.assign(
        new Error(
          "conflict with constraint booking_staff_no_overlapping_active",
        ),
        { code: "23P01" },
      ),
    );

    const response = await post();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BOOKING_CONFLICT");
    expect(response.body.error.message).toContain("horario");
  });

  it("crea una reserva, calcula su fin y registra quién la creó", async () => {
    const response = await post();

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe("booking-simulado");
    expect(response.body.data.status).toBe("CONFIRMED");

    expect(prismaMock.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONFIRMED",
          createdByUserId: "user-1",
          durationMinutesSnapshot: 30,
          priceSnapshot: 25000,
          startsAt: MONDAY_10AM_UTC,
          endsAt: MONDAY_1030AM_UTC,
        }),
      }),
    );
  });

  it("registra el evento CREATED con el mismo cliente de transacción", async () => {
    const txBookingCreate = vi.fn().mockResolvedValue({
      id: "booking-tx",
      businessId: BUSINESS_ID,
      customerId: "customer-simulado",
      serviceId: SERVICE_ID,
      staffId: STAFF_ID,
      status: "CONFIRMED",
      customerNameSnapshot: "Cliente de prueba",
      serviceNameSnapshot: "Corte de cabello",
      durationMinutesSnapshot: 30,
      priceSnapshot: 25000,
      startsAt: MONDAY_10AM_UTC,
      endsAt: MONDAY_1030AM_UTC,
      notes: null,
      createdAt: new Date("2026-10-20T12:00:00.000Z"),
    });
    const txEventCreate = vi.fn().mockResolvedValue({ id: "event-tx" });
    const tx = {
      ...prismaMock,
      booking: { ...prismaMock.booking, create: txBookingCreate },
      bookingEvent: { create: txEventCreate },
    };
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const response = await post();

    expect(response.status).toBe(201);
    expect(txBookingCreate).toHaveBeenCalledTimes(1);
    expect(txEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: BUSINESS_ID,
        bookingId: "booking-tx",
        type: "CREATED",
        actorType: "USER",
        actorUserId: "user-1",
        toStatus: "CONFIRMED",
      }),
    });
    // Ni la reserva ni el evento se escriben fuera de la transacción.
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
    expect(prismaMock.bookingEvent.create).not.toHaveBeenCalled();
  });

  it("si falla el evento de auditoría, la creación no se confirma", async () => {
    prismaMock.bookingEvent.create.mockRejectedValue(
      new Error("fallo de auditoría"),
    );

    const response = await post();

    expect(response.status).toBe(500);
    expect(response.body.data).toBeUndefined();
  });

  it("STAFF solo puede crear reservas para su propio empleado", async () => {
    prismaMock.membership.findFirst.mockResolvedValue({
      id: "membership-staff",
      role: "STAFF",
    });
    prismaMock.staff.findFirst.mockResolvedValueOnce({ id: "otro-empleado" });

    const response = await post();

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("STAFF_SCOPE");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("STAFF sin empleado vinculado no puede crear reservas", async () => {
    prismaMock.membership.findFirst.mockResolvedValue({
      id: "membership-staff",
      role: "STAFF",
    });
    prismaMock.staff.findFirst.mockResolvedValueOnce(null);

    const response = await post();

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("STAFF_SCOPE");
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  it("STAFF puede crear una reserva asignada a su propio empleado", async () => {
    prismaMock.membership.findFirst.mockResolvedValue({
      id: "membership-staff",
      role: "STAFF",
    });
    prismaMock.staff.findFirst.mockResolvedValueOnce({ id: STAFF_ID });

    const response = await post();

    expect(response.status).toBe(201);
    expect(prismaMock.booking.create).toHaveBeenCalledTimes(1);
  });

  it("rechaza una hora fuera del horario del negocio (422)", async () => {
    const response = await post(
      bookingPayload({ startsAt: "2026-10-26T19:00:00-05:00" }),
    );

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("SLOT_UNAVAILABLE");
    expect(response.body.error.details.reason).toBe("OUTSIDE_BUSINESS_HOURS");
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  it("rechaza un domingo cuando el negocio no atiende ese día", async () => {
    const response = await post(
      bookingPayload({ startsAt: "2026-10-25T10:00:00-05:00" }),
    );

    expect(response.status).toBe(422);
    expect(response.body.error.details.reason).toBe("OUTSIDE_BUSINESS_HOURS");
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  it("rechaza un horario que ya pasó", async () => {
    const response = await post(
      bookingPayload({ startsAt: "2026-10-19T10:00:00-05:00" }),
    );

    expect(response.status).toBe(422);
    expect(response.body.error.details.reason).toBe("PAST");
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  it("rechaza una hora cuando el empleado no trabaja en ese horario", async () => {
    prismaMock.staffAvailability.findMany.mockResolvedValue([
      { weekday: 1, startMinute: 13 * 60, endMinute: 18 * 60 },
    ]);

    const response = await post();

    expect(response.status).toBe(422);
    expect(response.body.error.details.reason).toBe(
      "OUTSIDE_STAFF_AVAILABILITY",
    );
  });

  it("rechaza una hora durante una ausencia del empleado", async () => {
    prismaMock.timeOff.findMany.mockResolvedValue([
      {
        startsAt: new Date("2026-10-26T14:00:00.000Z"),
        endsAt: new Date("2026-10-26T16:00:00.000Z"),
      },
    ]);

    const response = await post();

    expect(response.status).toBe(422);
    expect(response.body.error.details.reason).toBe("STAFF_TIME_OFF");
  });

  it("rechaza una hora durante un cierre del negocio", async () => {
    prismaMock.businessClosure.findMany.mockResolvedValue([
      {
        startsAt: new Date("2026-10-26T05:00:00.000Z"),
        endsAt: new Date("2026-10-27T05:00:00.000Z"),
      },
    ]);

    const response = await post();

    expect(response.status).toBe(422);
    expect(response.body.error.details.reason).toBe("BUSINESS_CLOSED");
  });
});

describe("GET /api/v1/availability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));

    mockBusinessSchedule();
    prismaMock.business.findFirst.mockResolvedValue({
      id: BUSINESS_ID,
      timezone: "America/Bogota",
    });
    prismaMock.service.findFirst.mockResolvedValue({
      id: SERVICE_ID,
      durationMinutes: 30,
    });
    prismaMock.staff.findFirst.mockResolvedValue({ id: STAFF_ID });
    prismaMock.staffService.findUnique.mockResolvedValue({
      businessId: BUSINESS_ID,
      staffId: STAFF_ID,
      serviceId: SERVICE_ID,
    });
    prismaMock.booking.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const query = (date = "2026-10-26") =>
    `/api/v1/availability?businessId=${BUSINESS_ID}&serviceId=${SERVICE_ID}&staffId=${STAFF_ID}&date=${date}`;

  it("rechaza parámetros inválidos sin consultar la base de datos", async () => {
    const response = await request(app).get(
      `/api/v1/availability?businessId=${BUSINESS_ID}&serviceId=${SERVICE_ID}&staffId=${STAFF_ID}&date=2026-02-30`,
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(prismaMock.business.findFirst).not.toHaveBeenCalled();
  });

  it("rechaza referencias que no corresponden al negocio", async () => {
    prismaMock.staffService.findUnique.mockResolvedValue(null);

    const response = await request(app).get(query());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_BOOKING_REFERENCE");
  });

  it("lista los horarios libres y excluye los ocupados por otras reservas", async () => {
    prismaMock.booking.findMany.mockResolvedValue([
      { startsAt: MONDAY_10AM_UTC, endsAt: MONDAY_1030AM_UTC },
    ]);

    const response = await request(app).get(query());

    expect(response.status).toBe(200);
    const { slots, timeZone, durationMinutes } = response.body.data;
    expect(timeZone).toBe("America/Bogota");
    expect(durationMinutes).toBe(30);

    const times = slots.map((slot: { time: string }) => slot.time);
    expect(times[0]).toBe("08:00");
    expect(times).toContain("09:30");
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("09:45");
    expect(times).toContain("10:30");
    expect(times[times.length - 1]).toBe("17:30");

    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          staffId: STAFF_ID,
          status: { in: ["PENDING", "CONFIRMED"] },
        }),
      }),
    );
  });

  it("excluye la propia reserva al calcular horarios para modificarla", async () => {
    const own = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const response = await request(app).get(
      `${query()}&excludeBookingId=${own}`,
    );

    expect(response.status).toBe(200);
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: own } }),
      }),
    );
  });

  it("rechaza un excludeBookingId que no es UUID", async () => {
    const response = await request(app).get(`${query()}&excludeBookingId=nope`);
    expect(response.status).toBe(400);
  });

  it("no ofrece horarios en un día en que el negocio no atiende", async () => {
    const response = await request(app).get(query("2026-10-25"));

    expect(response.status).toBe(200);
    expect(response.body.data.slots).toEqual([]);
  });
});
