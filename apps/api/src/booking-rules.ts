/**
 * Reglas de negocio de la gestión de reservas (Etapa 2A).
 *
 * Funciones puras: sin base de datos ni reloj del sistema (la hora llega como
 * parámetro), de modo que se pueden probar exhaustivamente.
 */
import type { MembershipRole } from "@prisma/client";

/** Roles que administran el negocio completo (el resto solo ve lo suyo). */
export function isManagerRole(role: MembershipRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export type BookingStatusName =
  "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | "EXPIRED";

/** Estados que ocupan el horario del empleado (ver la restricción SQL). */
export const ACTIVE_STATUSES = ["PENDING", "CONFIRMED"] as const;

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * Transiciones permitidas. Los estados finales son inmutables: reactivar una
 * reserva cancelada podría chocar con otra que ya tomó su horario, así que no
 * se permite (se crea una reserva nueva).
 */
const TRANSITIONS: Record<BookingStatusName, readonly BookingStatusName[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CANCELLED", "COMPLETED", "NO_SHOW"],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

export function canTransition(
  from: BookingStatusName,
  to: BookingStatusName,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Estados que solo tienen sentido una vez llegada la hora de la cita. */
export function requiresStartedBooking(to: BookingStatusName): boolean {
  return to === "COMPLETED" || to === "NO_SHOW";
}

/** Minutos completos que faltan para el inicio (negativo si ya empezó). */
export function noticeMinutes(startsAt: Date, now: Date): number {
  return Math.floor((startsAt.getTime() - now.getTime()) / 60_000);
}

export type NoticeRestriction = "CANCELLATION_NOTICE" | "RESCHEDULE_NOTICE";

export type NoticeOverrideRecord = {
  restriction: NoticeRestriction;
  requiredMinutes: number;
  actualMinutes: number;
};

export type NoticeDecision =
  | { kind: "ok" }
  | { kind: "override"; override: NoticeOverrideRecord }
  | {
      kind: "blocked";
      requiredMinutes: number;
      actualMinutes: number;
      canOverride: boolean;
    }
  | { kind: "override_forbidden" }
  | { kind: "reason_required" };

export const MIN_OVERRIDE_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 500;

export type ReasonParse = { ok: true; value: string | null } | { ok: false };

/** Normaliza un motivo opcional: texto recortado, máximo 500 caracteres. */
export function parseReason(raw: unknown): ReasonParse {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim();
  if (value.length > MAX_REASON_LENGTH) return { ok: false };
  return { ok: true, value: value.length > 0 ? value : null };
}

/**
 * Decide si se cumple el aviso mínimo configurado por el negocio.
 *
 * - `requiredMinutes <= 0` desactiva la restricción.
 * - El aviso se cumple si faltan al menos `requiredMinutes` minutos
 *   (exactamente el mínimo es válido).
 * - Si no se cumple, solo OWNER/ADMIN pueden omitirlo, indicándolo
 *   expresamente (`overrideRequested`) y con un motivo de al menos
 *   {@link MIN_OVERRIDE_REASON_LENGTH} caracteres. STAFF nunca puede.
 * - Si la restricción se cumple, una solicitud de omisión se ignora: no se
 *   registra una excepción que no hizo falta.
 */
export function decideNoticeRule(input: {
  restriction: NoticeRestriction;
  requiredMinutes: number;
  startsAt: Date;
  now: Date;
  role: MembershipRole;
  overrideRequested: boolean;
  reason: string | null;
}): NoticeDecision {
  const actualMinutes = noticeMinutes(input.startsAt, input.now);

  if (input.requiredMinutes <= 0 || actualMinutes >= input.requiredMinutes) {
    return { kind: "ok" };
  }

  const canOverride = isManagerRole(input.role);

  if (!input.overrideRequested) {
    return {
      kind: "blocked",
      requiredMinutes: input.requiredMinutes,
      actualMinutes,
      canOverride,
    };
  }

  if (!canOverride) return { kind: "override_forbidden" };

  if (!input.reason || input.reason.length < MIN_OVERRIDE_REASON_LENGTH) {
    return { kind: "reason_required" };
  }

  return {
    kind: "override",
    override: {
      restriction: input.restriction,
      requiredMinutes: input.requiredMinutes,
      actualMinutes,
    },
  };
}
