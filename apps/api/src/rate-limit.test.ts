import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

describe("createRateLimiter", () => {
  it("permite hasta el máximo de intentos y bloquea el siguiente", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 1000 });
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("a", 1)).toBe(true);
    expect(limiter.hit("a", 2)).toBe(true);
    expect(limiter.hit("a", 3)).toBe(false);
  });

  it("separa las claves entre sí", () => {
    const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("b", 0)).toBe(true);
    expect(limiter.hit("a", 1)).toBe(false);
  });

  it("vuelve a permitir intentos cuando termina la ventana", () => {
    const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("a", 500)).toBe(false);
    expect(limiter.hit("a", 2000)).toBe(true);
  });

  it("reset borra el historial de una clave", () => {
    const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    expect(limiter.hit("a", 0)).toBe(true);
    limiter.reset("a");
    expect(limiter.hit("a", 1)).toBe(true);
  });
});
