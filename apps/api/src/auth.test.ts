import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./auth.js";

describe("utilidades de autenticación", () => {
  it("verifica una contraseña correcta y rechaza una incorrecta", async () => {
    const password = "Una-clave-segura-2026";
    const storedHash = await hashPassword(password);

    expect(storedHash).not.toContain(password);
    expect(await verifyPassword(password, storedHash)).toBe(true);
    expect(await verifyPassword("otra-clave-incorrecta", storedHash)).toBe(
      false,
    );
  });

  it("usa sales diferentes para contraseñas iguales", async () => {
    const first = await hashPassword("Una-clave-segura-2026");
    const second = await hashPassword("Una-clave-segura-2026");

    expect(first).not.toBe(second);
    expect(await verifyPassword("Una-clave-segura-2026", first)).toBe(true);
    expect(await verifyPassword("Una-clave-segura-2026", second)).toBe(true);
  });

  it("rechaza hashes malformados sin lanzar una excepción", async () => {
    await expect(verifyPassword("cualquier-clave", "no-es-un-hash")).resolves
      .toBe(false);
  });

  it("genera tokens de sesión aleatorios", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("produce un hash estable del token sin revelar el token original", () => {
    const token = createSessionToken();
    const firstHash = hashSessionToken(token);

    expect(firstHash).toBe(hashSessionToken(token));
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(firstHash).not.toBe(token);
  });

  it("exige una longitud mínima al crear contraseñas nuevas", async () => {
    await expect(hashPassword("corta")).rejects.toThrow(
      "La contraseña debe tener entre 12 y 1024 caracteres.",
    );
  });
});