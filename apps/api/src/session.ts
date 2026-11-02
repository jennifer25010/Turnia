import type { Request, Response } from "express";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "./lib/prisma.js";
import { hashSessionToken } from "./auth.js";
import { isManagerRole } from "./booking-rules.js";

export const SESSION_COOKIE = "turnia_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function readSessionCookie(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name === SESSION_COOKIE && /^[A-Za-z0-9_-]{43}$/.test(value)) {
      return value;
    }
  }

  return null;
}

function cookieAttributes(maxAgeSeconds: number): string[] {
  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }

  return attributes;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    ...cookieAttributes(maxAgeSeconds),
  ].join("; ");
}

export function clearedSessionCookie(): string {
  return [`${SESSION_COOKIE}=`, ...cookieAttributes(0)].join("; ");
}

export type BusinessAccess = {
  userId: string;
  membershipId: string;
  role: MembershipRole;
};

function reject(
  response: Response,
  status: number,
  code: string,
  message: string,
): null {
  response.status(status).json({ error: { code, message } });
  return null;
}

/**
 * Valida la sesión (cookie HttpOnly cuyo hash existe en base de datos, no está
 * revocada ni vencida y pertenece a un usuario activo). Si no es válida
 * responde 401 y devuelve `null`.
 */
export async function authenticateSession(
  request: Request,
  response: Response,
): Promise<{ userId: string } | null> {
  const token = readSessionCookie(request.headers.cookie);

  if (!token) {
    return reject(response, 401, "UNAUTHENTICATED", "Debes iniciar sesión.");
  }

  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      user: {
        select: {
          id: true,
          active: true,
        },
      },
    },
  });

  if (!session || !session.user.active) {
    return reject(
      response,
      401,
      "UNAUTHENTICATED",
      "La sesión no es válida o ha expirado.",
    );
  }

  return { userId: session.user.id };
}

/**
 * Autorización del lado del servidor para recursos de un negocio.
 *
 * Exige sesión válida y una membresía del usuario en `businessId`. Si se
 * indica `allowedRoles`, además restringe por rol. Si no está autorizada
 * responde 401/403 y devuelve `null`; el llamador debe terminar sin más.
 */
export async function authorizeBusinessAccess(
  request: Request,
  response: Response,
  businessId: string,
  allowedRoles?: readonly MembershipRole[],
): Promise<BusinessAccess | null> {
  const user = await authenticateSession(request, response);
  if (!user) return null;

  const membership = await prisma.membership.findFirst({
    where: {
      businessId,
      userId: user.userId,
      ...(allowedRoles ? { role: { in: [...allowedRoles] } } : {}),
    },
    select: { id: true, role: true },
  });

  if (!membership) {
    return reject(
      response,
      403,
      "FORBIDDEN",
      "No tienes permiso para realizar esta acción en este negocio.",
    );
  }

  return {
    userId: user.userId,
    membershipId: membership.id,
    role: membership.role,
  };
}

/** Alcance de reservas que puede ver un usuario dentro de un negocio. */
export type BookingScope =
  { kind: "ALL" } | { kind: "OWN"; staffId: string } | { kind: "UNLINKED" };

/**
 * OWNER y ADMIN ven todas las reservas del negocio. STAFF solo las del
 * empleado activo vinculado a su usuario (`Staff.userId`); sin vínculo no
 * obtiene acceso a ninguna reserva.
 */
export async function bookingScopeFor(
  access: Pick<BusinessAccess, "userId" | "role">,
  businessId: string,
): Promise<BookingScope> {
  if (isManagerRole(access.role)) return { kind: "ALL" };

  const staff = await prisma.staff.findFirst({
    where: { businessId, userId: access.userId, active: true },
    select: { id: true },
  });

  return staff ? { kind: "OWN", staffId: staff.id } : { kind: "UNLINKED" };
}

export type BookingAccess = BusinessAccess & {
  businessId: string;
  bookingId: string;
  bookingStaffId: string;
};

/**
 * Autoriza el acceso a UNA reserva por su id, sin confiar en ningún
 * `businessId` enviado por el cliente:
 *   1. sesión válida (401),
 *   2. la reserva existe,
 *   3. el usuario tiene membresía en el negocio de ESA reserva,
 *   4. si es STAFF, la reserva está asignada a su empleado vinculado.
 * Los pasos 2 a 4 responden igual (404) para no revelar si una reserva de otro
 * negocio o de otro empleado existe.
 */
export async function resolveBookingAccess(
  request: Request,
  response: Response,
  bookingId: string,
): Promise<BookingAccess | null> {
  const user = await authenticateSession(request, response);
  if (!user) return null;

  const notFound = () =>
    reject(response, 404, "BOOKING_NOT_FOUND", "La reserva no existe.");

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, businessId: true, staffId: true },
  });
  if (!booking) return notFound();

  const membership = await prisma.membership.findFirst({
    where: { businessId: booking.businessId, userId: user.userId },
    select: { id: true, role: true },
  });
  if (!membership) return notFound();

  const access = {
    userId: user.userId,
    membershipId: membership.id,
    role: membership.role,
  };

  const scope = await bookingScopeFor(access, booking.businessId);
  if (scope.kind === "UNLINKED") return notFound();
  if (scope.kind === "OWN" && scope.staffId !== booking.staffId) {
    return notFound();
  }

  return {
    ...access,
    businessId: booking.businessId,
    bookingId: booking.id,
    bookingStaffId: booking.staffId,
  };
}
