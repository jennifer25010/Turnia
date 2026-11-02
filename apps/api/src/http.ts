import type { Response } from "express";

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  response.status(status).json({
    error: { code, message, ...(details ? { details } : {}) },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Versión esperada de una reserva: entero positivo. */
export function parseExpectedVersion(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
    ? value
    : null;
}
