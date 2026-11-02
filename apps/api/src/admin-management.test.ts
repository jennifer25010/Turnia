import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    session: { findFirst: vi.fn() },
    membership: { findFirst: vi.fn() },
    staff: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    business: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));

import { app } from "./app.js";

const BUSINESS_ID = "758ad131-14b1-42e4-8d74-d093bb62c41b";
const STAFF_ID = "cd5e9781-0edf-45e0-9e4f-3a32aef9b681";
const COOKIE = `turnia_session=${"d".repeat(43)}`;

function session() {
  prismaMock.session.findFirst.mockResolvedValue({
    user: { id: "user-1", active: true },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /staff (vínculos de empleados)", () => {
  const get = () =>
    request(app)
      .get(`/api/v1/staff?businessId=${BUSINESS_ID}`)
      .set("Cookie", COOKIE);

  it("exige sesión", async () => {
    const response = await request(app).get(
      `/api/v1/staff?businessId=${BUSINESS_ID}`,
    );
    expect(response.status).toBe(401);
  });

  it("solo OWNER/ADMIN: la consulta de membresía filtra por esos roles", async () => {
    session();
    prismaMock.membership.findFirst.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(403);
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: BUSINESS_ID,
        userId: "user-1",
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { id: true, role: true },
    });
    expect(prismaMock.staff.findMany).not.toHaveBeenCalled();
  });

  it("lista los empleados del negocio con su usuario vinculado", async () => {
    session();
    prismaMock.membership.findFirst.mockResolvedValue({
      id: "m",
      role: "OWNER",
    });
    prismaMock.staff.findMany.mockResolvedValue([
      {
        id: STAFF_ID,
        displayName: "Ana",
        active: true,
        userId: null,
        user: null,
      },
    ]);

    const response = await get();

    expect(response.status).toBe(200);
    expect(response.body.data[0].user).toBeNull();
    expect(prismaMock.staff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: BUSINESS_ID } }),
    );
  });
});

describe("PUT /staff/:staffId/user", () => {
  const put = (body: unknown) =>
    request(app)
      .put(`/api/v1/staff/${STAFF_ID}/user`)
      .set("Cookie", COOKIE)
      .send(body as object);

  function asManager() {
    session();
    prismaMock.staff.findUnique.mockResolvedValue({
      id: STAFF_ID,
      businessId: BUSINESS_ID,
    });
  }

  it("exige sesión", async () => {
    const response = await request(app)
      .put(`/api/v1/staff/${STAFF_ID}/user`)
      .send({ email: null });
    expect(response.status).toBe(401);
  });

  it.each([
    ["sin email", {}],
    ["email inválido", { email: "no-es-correo" }],
    ["email que no es texto", { email: 5 }],
  ])("valida el cuerpo: %s", async (_n, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(prismaMock.staff.update).not.toHaveBeenCalled();
  });

  it("un usuario que no administra el negocio recibe 404 y no cambia nada", async () => {
    asManager();
    prismaMock.membership.findFirst.mockResolvedValue(null);

    const response = await put({ email: "ana@negocio.co" });

    expect(response.status).toBe(404);
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: BUSINESS_ID,
        userId: "user-1",
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { id: true },
    });
    expect(prismaMock.staff.update).not.toHaveBeenCalled();
  });

  it("empleado inexistente → 404", async () => {
    session();
    prismaMock.staff.findUnique.mockResolvedValue(null);
    const response = await put({ email: "ana@negocio.co" });
    expect(response.status).toBe(404);
  });

  it("solo vincula usuarios que son miembros activos de ESE negocio", async () => {
    asManager();
    prismaMock.membership.findFirst
      .mockResolvedValueOnce({ id: "m-admin" }) // quien hace la solicitud
      .mockResolvedValueOnce(null); // el usuario a vincular no es miembro

    const response = await put({ email: "  Extraño@Otro.co " });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("USER_NOT_IN_BUSINESS");
    expect(prismaMock.membership.findFirst).toHaveBeenLastCalledWith({
      where: {
        businessId: BUSINESS_ID,
        user: { emailNormalized: "extraño@otro.co", active: true },
      },
      select: { userId: true },
    });
    expect(prismaMock.staff.update).not.toHaveBeenCalled();
  });

  it("vincula un miembro del negocio", async () => {
    asManager();
    prismaMock.membership.findFirst
      .mockResolvedValueOnce({ id: "m-admin" })
      .mockResolvedValueOnce({ userId: "user-staff" });
    prismaMock.staff.update.mockResolvedValue({
      id: STAFF_ID,
      displayName: "Ana",
      active: true,
      userId: "user-staff",
      user: { id: "user-staff", email: "ana@negocio.co", fullName: "Ana" },
    });

    const response = await put({ email: "ana@negocio.co" });

    expect(response.status).toBe(200);
    expect(prismaMock.staff.update).toHaveBeenCalledWith({
      where: { id: STAFF_ID },
      data: { userId: "user-staff" },
      select: expect.any(Object),
    });
  });

  it("un usuario ya vinculado a otro empleado → 409", async () => {
    asManager();
    prismaMock.membership.findFirst
      .mockResolvedValueOnce({ id: "m-admin" })
      .mockResolvedValueOnce({ userId: "user-staff" });
    prismaMock.staff.update.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const response = await put({ email: "ana@negocio.co" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("USER_ALREADY_LINKED");
  });

  it("email null desvincula al empleado", async () => {
    asManager();
    prismaMock.membership.findFirst.mockResolvedValueOnce({ id: "m-admin" });
    prismaMock.staff.update.mockResolvedValue({
      id: STAFF_ID,
      displayName: "Ana",
      active: true,
      userId: null,
      user: null,
    });

    const response = await put({ email: null });

    expect(response.status).toBe(200);
    expect(prismaMock.staff.update).toHaveBeenCalledWith({
      where: { id: STAFF_ID },
      data: { userId: null },
      select: expect.any(Object),
    });
  });
});

describe("políticas del negocio /businesses/:id/settings", () => {
  const url = `/api/v1/businesses/${BUSINESS_ID}/settings`;

  function asRole(role: string | null) {
    session();
    prismaMock.membership.findFirst.mockResolvedValue(
      role ? { id: "m", role } : null,
    );
  }

  it("GET y PATCH exigen sesión", async () => {
    expect((await request(app).get(url)).status).toBe(401);
    expect(
      (await request(app).patch(url).send({ cancellationNoticeMinutes: 60 }))
        .status,
    ).toBe(401);
  });

  it("STAFF no puede leer ni modificar las políticas (la consulta filtra OWNER/ADMIN)", async () => {
    asRole(null);
    const response = await request(app)
      .patch(url)
      .set("Cookie", COOKIE)
      .send({ cancellationNoticeMinutes: 60 });
    expect(response.status).toBe(403);
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: { in: ["OWNER", "ADMIN"] } }),
      }),
    );
    expect(prismaMock.business.update).not.toHaveBeenCalled();
  });

  it("GET devuelve las políticas actuales", async () => {
    asRole("OWNER");
    prismaMock.business.findUnique.mockResolvedValue({
      cancellationNoticeMinutes: 120,
      rescheduleNoticeMinutes: 60,
    });
    const response = await request(app).get(url).set("Cookie", COOKIE);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      cancellationNoticeMinutes: 120,
      rescheduleNoticeMinutes: 60,
    });
  });

  it.each([
    ["negativo", { cancellationNoticeMinutes: -1 }],
    ["decimal", { cancellationNoticeMinutes: 1.5 }],
    ["texto", { rescheduleNoticeMinutes: "60" }],
    ["sobre el máximo (30 días)", { rescheduleNoticeMinutes: 43201 }],
    ["campo desconocido", { cancellationNoticeMinutes: 10, otro: 1 }],
    ["vacío", {}],
  ])("PATCH rechaza datos inválidos: %s", async (_n, body) => {
    const response = await request(app)
      .patch(url)
      .set("Cookie", COOKIE)
      .send(body);
    expect(response.status).toBe(400);
    expect(prismaMock.business.update).not.toHaveBeenCalled();
  });

  it("PATCH actualiza solo los campos enviados (límites 0 y 43200 válidos)", async () => {
    asRole("ADMIN");
    prismaMock.business.update.mockResolvedValue({
      cancellationNoticeMinutes: 0,
      rescheduleNoticeMinutes: 43200,
    });

    const response = await request(app)
      .patch(url)
      .set("Cookie", COOKIE)
      .send({ cancellationNoticeMinutes: 0, rescheduleNoticeMinutes: 43200 });

    expect(response.status).toBe(200);
    expect(prismaMock.business.update).toHaveBeenCalledWith({
      where: { id: BUSINESS_ID },
      data: { cancellationNoticeMinutes: 0, rescheduleNoticeMinutes: 43200 },
      select: expect.any(Object),
    });
  });
});
