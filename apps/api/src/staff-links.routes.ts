/**
 * Vinculación entre empleados (`Staff`) y cuentas de usuario (`User`).
 *
 * Un STAFF solo gestiona las reservas del empleado vinculado a su usuario; sin
 * vínculo no ve ninguna. Solo OWNER y ADMIN administran estos vínculos.
 */
import { Router } from "express";
import { prisma } from "./lib/prisma.js";
import { isUniqueViolation } from "./db-errors.js";
import { isRecord, sendError, uuidPattern } from "./http.js";
import { authenticateSession, authorizeBusinessAccess } from "./session.js";

export const staffLinksRouter = Router();

const MANAGERS = ["OWNER", "ADMIN"] as const;

const staffSelect = {
  id: true,
  displayName: true,
  active: true,
  userId: true,
  user: { select: { id: true, email: true, fullName: true } },
} as const;

staffLinksRouter.get("/staff", async (request, response) => {
  const businessId = request.query.businessId;
  if (typeof businessId !== "string" || !uuidPattern.test(businessId)) {
    return sendError(
      response,
      400,
      "BAD_REQUEST",
      "Debes proporcionar un businessId válido",
    );
  }

  const access = await authorizeBusinessAccess(
    request,
    response,
    businessId,
    MANAGERS,
  );
  if (!access) return;

  const staff = await prisma.staff.findMany({
    where: { businessId },
    orderBy: { displayName: "asc" },
    select: staffSelect,
  });

  response.status(200).json({ data: staff });
});

staffLinksRouter.put("/staff/:staffId/user", async (request, response) => {
  const staffId = request.params.staffId;
  if (!uuidPattern.test(staffId)) {
    return sendError(
      response,
      400,
      "BAD_REQUEST",
      "El identificador del empleado no es válido.",
    );
  }

  const body: unknown = request.body;
  if (!isRecord(body) || !("email" in body)) {
    return sendError(
      response,
      400,
      "BAD_REQUEST",
      'Envía { "email": "correo" } para vincular o { "email": null } para desvincular.',
    );
  }

  const rawEmail = body.email;
  const email =
    typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : null;
  if (
    rawEmail !== null &&
    (typeof rawEmail !== "string" ||
      email === null ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ) {
    return sendError(
      response,
      400,
      "BAD_REQUEST",
      "El correo electrónico no tiene un formato válido.",
    );
  }

  const user = await authenticateSession(request, response);
  if (!user) return;

  const notFound = () =>
    sendError(response, 404, "STAFF_NOT_FOUND", "El empleado no existe.");

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { id: true, businessId: true },
  });
  if (!staff) return notFound();

  // Solo OWNER/ADMIN del negocio del empleado; para el resto, "no existe".
  const membership = await prisma.membership.findFirst({
    where: {
      businessId: staff.businessId,
      userId: user.userId,
      role: { in: [...MANAGERS] },
    },
    select: { id: true },
  });
  if (!membership) return notFound();

  let targetUserId: string | null = null;
  if (email !== null) {
    // El usuario debe ser miembro ACTIVO de este mismo negocio. Si no lo es,
    // se responde igual que si no existiera, sin revelar cuentas de otros.
    const target = await prisma.membership.findFirst({
      where: {
        businessId: staff.businessId,
        user: { emailNormalized: email, active: true },
      },
      select: { userId: true },
    });
    if (!target) {
      return sendError(
        response,
        422,
        "USER_NOT_IN_BUSINESS",
        "No hay un miembro activo del negocio con ese correo. Primero debe pertenecer al negocio.",
      );
    }
    targetUserId = target.userId;
  }

  try {
    const updated = await prisma.staff.update({
      where: { id: staff.id },
      data: { userId: targetUserId },
      select: staffSelect,
    });
    response.status(200).json({ data: updated });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return sendError(
        response,
        409,
        "USER_ALREADY_LINKED",
        "Ese usuario ya está vinculado a otro empleado de este negocio.",
      );
    }
    throw error;
  }
});
