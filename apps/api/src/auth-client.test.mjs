import { describe, expect, it, vi } from "vitest";
import {
  fetchSession,
  loginRequest,
  logoutRequest,
  parseSessionInfo,
} from "../../web/src/auth-api.ts";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sessionBody = {
  data: {
    user: { id: "u1", email: "a@b.co", fullName: "Ana Pérez" },
    memberships: [
      {
        businessId: "758ad131-14b1-42e4-8d74-d093bb62c41b",
        businessName: "Turnia Demo",
        businessSlug: "turnia-demo",
        timezone: "America/Bogota",
        role: "OWNER",
      },
    ],
    expiresAt: "2026-11-07T00:00:00.000Z",
  },
};

describe("cliente de autenticación", () => {
  it("interpreta la sesión y descarta roles desconocidos", () => {
    expect(parseSessionInfo(sessionBody)?.memberships[0]?.role).toBe("OWNER");
    const invalid = structuredClone(sessionBody);
    invalid.data.memberships[0].role = "SUPERADMIN";
    expect(parseSessionInfo(invalid)).toBeNull();
    expect(parseSessionInfo({ data: { user: {} } })).toBeNull();
  });

  it("devuelve null cuando no hay sesión (401)", async () => {
    const request = vi.fn().mockResolvedValue(json({ error: {} }, 401));
    await expect(fetchSession(request)).resolves.toBeNull();
  });

  it("devuelve la sesión válida y falla ante respuestas inesperadas", async () => {
    await expect(
      fetchSession(vi.fn().mockResolvedValue(json(sessionBody))),
    ).resolves.toMatchObject({ user: { fullName: "Ana Pérez" } });
    await expect(
      fetchSession(vi.fn().mockResolvedValue(json({ nope: true }))),
    ).rejects.toThrow("formato inesperado");
    await expect(
      fetchSession(vi.fn().mockResolvedValue(json({}, 500))),
    ).rejects.toThrow("código 500");
  });

  it("envía las credenciales por POST y traduce los errores", async () => {
    const ok = vi.fn().mockResolvedValue(json({ data: {} }));
    await loginRequest("a@b.co", "clave", ok);
    expect(ok).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "a@b.co", password: "clave" }),
      }),
    );

    await expect(
      loginRequest("a@b.co", "x", vi.fn().mockResolvedValue(json({}, 401))),
    ).rejects.toThrow("Correo o contraseña incorrectos.");
    await expect(
      loginRequest(
        "a@b.co",
        "x",
        vi
          .fn()
          .mockResolvedValue(
            json({ error: { message: "Demasiados intentos." } }, 429),
          ),
      ),
    ).rejects.toThrow("Demasiados intentos.");
  });

  it("cierra la sesión con POST", async () => {
    const request = vi.fn().mockResolvedValue(json({ data: {} }));
    await logoutRequest(request);
    expect(request).toHaveBeenCalledWith("/api/v1/auth/logout", {
      method: "POST",
    });
  });
});
