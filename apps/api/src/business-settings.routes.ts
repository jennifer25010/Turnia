/** Políticas de reserva configurables por negocio (solo OWNER y ADMIN). */
import { Router } from "express";
import { prisma } from "./lib/prisma.js";
import { isRecord, sendError, uuidPattern } from "./http.js";
import { authorizeBusinessAccess } from "./session.js";

export const businessSettingsRouter = Router();

const MANAGERS = ["OWNER", "ADMIN"] as const;
const MAX_NOTICE_MINUTES = 43_200; // 30 días; coincide con el CHECK en SQL
const fields = [
  "cancellationNoticeMinutes",
  "rescheduleNoticeMinutes",
] as const;

const settingsSelect = {
  cancellationNoticeMinutes: true,
  rescheduleNoticeMinutes: true,
} as const;

businessSettingsRouter.get(
  "/businesses/:businessId/settings",
  async (request, response) => {
    const businessId = request.params.businessId;
    if (!uuidPattern.test(businessId)) {
      return sendError(
        response,
        400,
        "BAD_REQUEST",
        "businessId no es válido.",
      );
    }

    const access = await authorizeBusinessAccess(
      request,
      response,
      businessId,
      MANAGERS,
    );
    if (!access) return;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: settingsSelect,
    });
    if (!business) {
      return sendError(
        response,
        404,
        "BUSINESS_NOT_FOUND",
        "El negocio no existe.",
      );
    }

    response.status(200).json({ data: business });
  },
);

businessSettingsRouter.patch(
  "/businesses/:businessId/settings",
  async (request, response) => {
    const businessId = request.params.businessId;
    if (!uuidPattern.test(businessId)) {
      return sendError(
        response,
        400,
        "BAD_REQUEST",
        "businessId no es válido.",
      );
    }

    const body: unknown = request.body;
    if (!isRecord(body)) {
      return sendError(
        response,
        400,
        "BAD_REQUEST",
        "El cuerpo debe ser un objeto JSON",
      );
    }

    const unknownKeys = Object.keys(body).filter(
      (key) => !(fields as readonly string[]).includes(key),
    );
    const data: Partial<Record<(typeof fields)[number], number>> = {};
    let invalid = unknownKeys.length > 0;

    for (const field of fields) {
      const value = body[field];
      if (value === undefined) continue;
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > MAX_NOTICE_MINUTES
      ) {
        invalid = true;
      } else {
        data[field] = value;
      }
    }

    if (invalid || Object.keys(data).length === 0) {
      return sendError(
        response,
        400,
        "BAD_REQUEST",
        `Envía cancellationNoticeMinutes y/o rescheduleNoticeMinutes como enteros entre 0 y ${MAX_NOTICE_MINUTES}.`,
      );
    }

    const access = await authorizeBusinessAccess(
      request,
      response,
      businessId,
      MANAGERS,
    );
    if (!access) return;

    const updated = await prisma.business.update({
      where: { id: businessId },
      data,
      select: settingsSelect,
    });

    response.status(200).json({ data: updated });
  },
);
