import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("./lib/prisma.js", () => ({
  prisma: prismaMock,
}));

import { app } from "./app.js";
import { createSessionToken, hashPassword, hashSessionToken } from "./auth.js";

const testPassword = "Turnia-Pruebas-2026!";
let passwordHash: string;

const activeUser = () => ({
  id: "user-test-001",
  email: "admin@turnia.test",
  fullName: "Administrador de pruebas",
  passwordHash,
  active: true,
});

beforeAll(async () => {
  passwordHash = await hashPassword(testPassword);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rutas de autenticación", () => {
  it("inicia sesión con credenciales correctas y crea una sesión", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeUser());
    prismaMock.session.create.mockResolvedValue({});

    const response = await request(app).post("/api/v1/auth/login").send({
      email: "  ADMIN@TURNIA.TEST ",
      password: testPassword,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual({
      id: "user-test-001",
      email: "admin@turnia.test",
      fullName: "Administrador de pruebas",
    });
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(response.headers["set-cookie"]![0]!).toContain("turnia_session=");
    expect(response.headers["set-cookie"]![0]!).toContain("HttpOnly");
    expect(response.headers["set-cookie"]![0]!).toContain("SameSite=Lax");

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emailNormalized: "admin@turnia.test" },
      }),
    );

    const createdSession = prismaMock.session.create.mock.calls[0]![0];

    expect(createdSession.data.userId).toBe("user-test-001");
    expect(createdSession.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createdSession.data.tokenHash).not.toBe(
      response.headers["set-cookie"]![0]!.match(/turnia_session=([^;]+)/)?.[1],
    );
    expect(createdSession.data.expiresAt).toBeInstanceOf(Date);
  });

  it("rechaza credenciales incorrectas con un mensaje genérico", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const response = await request(app).post("/api/v1/auth/login").send({
      email: "desconocido@turnia.test",
      password: testPassword,
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(response.body.error.message).toBe(
      "Correo o contraseña incorrectos.",
    );
    expect(prismaMock.session.create).not.toHaveBeenCalled();
  });

  it("rechaza /me cuando no se envía una cookie de sesión", async () => {
    const response = await request(app).get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
    expect(prismaMock.session.findFirst).not.toHaveBeenCalled();
  });

  it("reconoce una sesión válida y consulta usando el hash del token", async () => {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 60_000);

    prismaMock.session.findFirst.mockResolvedValue({
      expiresAt,
      user: {
        id: "user-test-001",
        email: "admin@turnia.test",
        fullName: "Administrador de pruebas",
        active: true,
      },
    });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe("user-test-001");

    expect(prismaMock.session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: hashSessionToken(token),
          revokedAt: null,
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
  });

  it("revoca la sesión y limpia la cookie al cerrar sesión", async () => {
    const token = createSessionToken();
    prismaMock.session.updateMany.mockResolvedValue({ count: 1 });

    const response = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.loggedOut).toBe(true);

    expect(prismaMock.session.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashSessionToken(token),
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });

    expect(response.headers["set-cookie"]![0]!).toContain("turnia_session=");
    expect(response.headers["set-cookie"]![0]!).toContain("Max-Age=0");
  });

  it("incluye en /me solo las membresías de negocios activos", async () => {
    const token = createSessionToken();

    prismaMock.session.findFirst.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: "user-test-001",
        email: "admin@turnia.test",
        fullName: "Administrador de pruebas",
        active: true,
        memberships: [
          {
            role: "OWNER",
            business: {
              id: "758ad131-14b1-42e4-8d74-d093bb62c41b",
              name: "Turnia Demo",
              slug: "turnia-demo",
              timezone: "America/Bogota",
              active: true,
            },
          },
          {
            role: "STAFF",
            business: {
              id: "9a1f5d00-0000-4000-8000-000000000001",
              name: "Negocio inactivo",
              slug: "inactivo",
              timezone: "America/Bogota",
              active: false,
            },
          },
        ],
      },
    });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `turnia_session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.memberships).toEqual([
      {
        businessId: "758ad131-14b1-42e4-8d74-d093bb62c41b",
        businessName: "Turnia Demo",
        businessSlug: "turnia-demo",
        timezone: "America/Bogota",
        role: "OWNER",
      },
    ]);
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("limita los intentos repetidos de inicio de sesión (429)", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "bloqueado@turnia.test", password: testPassword });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
