/**
 * Gestión de reservas desde el panel (Etapa 2A): detalle con historial,
 * cancelación, modificación y cambio de estado.
 *
 * Principios:
 * - Autorización en el servidor por reserva (`resolveBookingAccess`): sesión,
 *   membresía del negocio de ESA reserva y, para STAFF, que sea suya.
 * - Atomicidad: el cambio y su `BookingEvent` se escriben con el MISMO cliente
 *   de transacción; si el evento falla, el cambio se revierte.
 * - Concurrencia: cada cambio es un UPDATE condicionado por `version` y por el
 *   estado esperado; si otra operación se adelantó, no afecta filas y se
 *   responde 409. Los choques de horario los decide PostgreSQL.
 */
import { Router, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma.js";
import { checkSlot, isValidTimeZone } from "./availability.js";
import {
  ACTIVE_STATUSES,
  canTransition,
  decideNoticeRule,
  isActiveStatus,
  isManagerRole,
  parseReason,
  requiresStartedBooking,
  type BookingStatusName,
  type NoticeDecision,
  type NoticeRestriction,
} from "./booking-rules.js";
import { bookingSummarySelect } from "./booking-select.js";
import { isBookingConflictError } from "./db-errors.js";
import {
  isRecord,
  parseExpectedVersion,
  sendError,
  uuidPattern,
} from "./http.js";
import { resolveBookingAccess } from "./session.js";
import { slotRejectionMessages } from "./slot-messages.js";

export const bookingManagementRouter = Router();

const staleMessage =
  "La reserva cambió mientras la editabas. Recarga los datos e inténtalo de nuevo.";

function badBookingId(response: Response): void {
  sendError(
    response,
    400,
    "BAD_REQUEST",
    "El identificador de la reserva no es válido.",
  );
}

function sendNoticeFailure(
  response: Response,
  decision: Exclude<NoticeDecision, { kind: "ok" } | { kind: "override" }>,
  restriction: NoticeRestriction,
): void {
  if (decision.kind === "blocked") {
    sendError(
      response,
      422,
      "NOTICE_REQUIRED",
      restriction === "CANCELLATION_NOTICE"
        ? "No se cumple el aviso mínimo para cancelar esta reserva."
        : "No se cumple el aviso mínimo para modificar esta reserva.",
      {
        restriction,
        requiredMinutes: decision.requiredMinutes,
        actualMinutes: decision.actualMinutes,
        canOverride: decision.canOverride,
      },
    );
    return;
  }
  if (decision.kind === "override_forbidden") {
    sendError(
      response,
      403,
      "OVERRIDE_NOT_ALLOWED",
      "Solo un propietario o administrador puede omitir el aviso mínimo.",
    );
    return;
  }
  sendError(
    response,
    400,
    "REASON_REQUIRED",
    "Para omitir el aviso mínimo debes indicar un motivo (al menos 5 caracteres).",
  );
}

type OverrideRecord = {
  restriction: NoticeRestriction;
  requiredMinutes: number;
  actualMinutes: number;
};

function overrideJson(
  override: OverrideRecord,
  authorizedByUserId: string,
): Prisma.InputJsonValue {
  return {
    restriction: override.restriction,
    requiredMinutes: override.requiredMinutes,
    actualMinutes: override.actualMinutes,
    authorizedByUserId,
  };
}

// ---------------------------------------------------------------------------
// Detalle con historial
// ---------------------------------------------------------------------------

bookingManagementRouter.get("/bookings/:id", async (request, response) => {
  const id = request.params.id;
  if (!uuidPattern.test(id)) return badBookingId(response);

  const access = await resolveBookingAccess(request, response, id);
  if (!access) return;

  const booking = await prisma.booking.findFirst({
    where: { id, businessId: access.businessId },
    select: {
      ...bookingSummarySelect,
      business: {
        select: {
          timezone: true,
          cancellationNoticeMinutes: true,
          rescheduleNoticeMinutes: true,
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          actorType: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          data: true,
          createdAt: true,
          actorUser: { select: { fullName: true } },
        },
      },
    },
  });

  if (!booking) {
    return sendError(
      response,
      404,
      "BOOKING_NOT_FOUND",
      "La reserva no existe.",
    );
  }

  response.status(200).json({
    data: {
      ...booking,
      // Las reservas anteriores a la Etapa 2 no tienen evento CREATED: no se
      // inventa historial, se indica que solo existe desde la Etapa 2.
      historyAvailableFromStage2: !booking.events.some(
        (event) => event.type === "CREATED",
      ),
      permissions: {
        canOverrideNotice: isManagerRole(access.role),
        canChangeStaff: isManagerRole(access.role),
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

bookingManagementRouter.post(
  "/bookings/:id/cancel",
  async (request, response) => {
    const id = request.params.id;
    if (!uuidPattern.test(id)) return badBookingId(response);

    const body: unknown = request.body;
    if (!isRecord(body)) {
      return sendError(
        response,
        400,
        "BAD_REQUEST",
        "El cuerpo debe ser un objeto JSON",
      );
    }

    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    const reason = parseReason(body.reason);
    if (
      expectedVersion === null ||
      !reason.ok ||
      (body.override !== undefined && typeof body.override !== "boolean")
    ) {
      return sendError(
        response,
        400,
        "BAD_REQUEST",
        "Revisa expectedVersion (entero positivo), reason (máx. 500 caracteres) y override (booleano).",
      );
    }
    const overrideRequested = body.override === true;

    const access = await resolveBookingAccess(request, response, id);
    if (!access) return;

    const now = new Date();

    const outcome = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id, businessId: access.businessId },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          version: true,
          business: { select: { cancellationNoticeMinutes: true } },
        },
      });
      if (!booking) return { kind: "not_found" as const };
      if (booking.version !== expectedVersion)
        return { kind: "stale" as const };
      if (!isActiveStatus(booking.status)) {
        return { kind: "invalid_state" as const, status: booking.status };
      }
      if (booking.endsAt.getTime() <= now.getTime()) {
        return { kind: "ended" as const };
      }

      const decision = decideNoticeRule({
        restriction: "CANCELLATION_NOTICE",
        requiredMinutes: booking.business.cancellationNoticeMinutes,
        startsAt: booking.startsAt,
        now,
        role: access.role,
        overrideRequested,
        reason: reason.value,
      });
      if (decision.kind !== "ok" && decision.kind !== "override") {
        return { kind: "notice" as const, decision };
      }

      // UPDATE condicionado: solo cambia si nadie modificó la reserva antes.
      const updated = await tx.booking.updateMany({
        where: {
          id,
          businessId: access.businessId,
          version: expectedVersion,
          status: { in: [...ACTIVE_STATUSES] },
        },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancelReason: reason.value,
          cancelledByUserId: access.userId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return { kind: "stale" as const };

      await tx.bookingEvent.create({
        data: {
          businessId: access.businessId,
          bookingId: id,
          type: "CANCELLED",
          actorType: "USER",
          actorUserId: access.userId,
          fromStatus: booking.status,
          toStatus: "CANCELLED",
          reason: reason.value,
          data: {
            before: { status: booking.status },
            after: { status: "CANCELLED" },
            ...(decision.kind === "override"
              ? { override: overrideJson(decision.override, access.userId) }
              : {}),
          },
        },
      });

      const result = await tx.booking.findFirst({
        where: { id, businessId: access.businessId },
        select: bookingSummarySelect,
      });
      return { kind: "ok" as const, booking: result };
    });

    switch (outcome.kind) {
      case "not_found":
        return sendError(
          response,
          404,
          "BOOKING_NOT_FOUND",
          "La reserva no existe.",
        );
      case "stale":
        return sendError(response, 409, "STALE_BOOKING", staleMessage);
      case "invalid_state":
        return sendError(
          response,
          409,
          "INVALID_STATE",
          "Solo se pueden cancelar reservas pendientes o confirmadas.",
          { status: outcome.status },
        );
      case "ended":
        return sendError(
          response,
          422,
          "BOOKING_ALREADY_ENDED",
          "La reserva ya terminó; usa el estado Completada o No asistió.",
        );
      case "notice":
        return sendNoticeFailure(
          response,
          outcome.decision,
          "CANCELLATION_NOTICE",
        );
      case "ok":
        response.status(200).json({ data: outcome.booking });
    }
  },
);

// ---------------------------------------------------------------------------
// Modificar (fecha/hora, servicio y/o empleado)
// ---------------------------------------------------------------------------

bookingManagementRouter.patch("/bookings/:id", async (request, response) => {
  const id = request.params.id;
  if (!uuidPattern.test(id)) return badBookingId(response);

  const body: unknown = request.body;
  if (!isRecord(body)) {
    return sendError(
      response,
      400,
      "BAD_REQUEST",
      "El cuerpo debe ser un objeto JSON",
    );
  }

  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  const reason = parseReason(body.reason);
  const { startsAt, serviceId, staffId, override } = body;

  const startsAtValid =
    startsAt === undefined ||
    (typeof startsAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(startsAt) &&
      Number.isFinite(new Date(startsAt).getTime()));
  const idValid = (value: unknown) =>
    value === undefined ||
    (typeof value === "string" && uuidPattern.test(value));

  if (
    expectedVersion === null ||
    !reason.ok ||
    !startsAtValid ||
    !idValid(serviceId) ||
    !idValid(staffId) ||
    (override !== undefined && typeof override !== "boolean")
  ) {
    return sendError(
      response,
      400,
      "BAD_REQUEST",
      "Revisa expectedVersion, startsAt (ISO con hora), serviceId, staffId, reason y override.",
    );
  }
  if (
    startsAt === undefined &&
    serviceId === undefined &&
    staffId === undefined
  ) {
    return sendError(
      response,
      400,
      "NO_CHANGES",
      "Indica al menos un cambio: startsAt, serviceId o staffId.",
    );
  }

  const access = await resolveBookingAccess(request, response, id);
  if (!access) return;

  const overrideRequested = override === true;
  const now = new Date();
  const requestedStart =
    typeof startsAt === "string" ? new Date(startsAt) : null;
  const requestedServiceId = typeof serviceId === "string" ? serviceId : null;
  const requestedStaffId = typeof staffId === "string" ? staffId : null;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id, businessId: access.businessId },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          version: true,
          serviceId: true,
          staffId: true,
          serviceNameSnapshot: true,
          durationMinutesSnapshot: true,
          priceSnapshot: true,
          business: {
            select: { timezone: true, rescheduleNoticeMinutes: true },
          },
        },
      });
      if (!booking) return { kind: "not_found" as const };
      if (booking.version !== expectedVersion)
        return { kind: "stale" as const };
      if (!isActiveStatus(booking.status)) {
        return { kind: "invalid_state" as const, status: booking.status };
      }
      if (booking.startsAt.getTime() <= now.getTime()) {
        return { kind: "started" as const };
      }

      const newServiceId = requestedServiceId ?? booking.serviceId;
      const newStaffId = requestedStaffId ?? booking.staffId;
      const newStart = requestedStart ?? booking.startsAt;

      const unchanged =
        newServiceId === booking.serviceId &&
        newStaffId === booking.staffId &&
        newStart.getTime() === booking.startsAt.getTime();
      if (unchanged) return { kind: "no_changes" as const };

      // Solo OWNER/ADMIN reasignan la reserva a otro empleado.
      if (newStaffId !== booking.staffId && !isManagerRole(access.role)) {
        return { kind: "staff_forbidden" as const };
      }

      const decision = decideNoticeRule({
        restriction: "RESCHEDULE_NOTICE",
        requiredMinutes: booking.business.rescheduleNoticeMinutes,
        startsAt: booking.startsAt,
        now,
        role: access.role,
        overrideRequested,
        reason: reason.value,
      });
      if (decision.kind !== "ok" && decision.kind !== "override") {
        return { kind: "notice" as const, decision };
      }

      const businessId = access.businessId;
      const service = await tx.service.findFirst({
        where: { id: newServiceId, businessId, active: true },
        select: { id: true, name: true, durationMinutes: true, price: true },
      });
      const staff = await tx.staff.findFirst({
        where: { id: newStaffId, businessId, active: true },
        select: { id: true },
      });
      if (!service || !staff) return { kind: "invalid_reference" as const };

      const assignment = await tx.staffService.findUnique({
        where: {
          staffId_serviceId: { staffId: newStaffId, serviceId: newServiceId },
        },
      });
      if (!assignment || assignment.businessId !== businessId) {
        return { kind: "invalid_reference" as const };
      }

      // Si el servicio no cambia se conservan los datos acordados al reservar
      // (duración y precio); si cambia, se toman del nuevo servicio.
      const serviceChanged = newServiceId !== booking.serviceId;
      const durationMinutes = serviceChanged
        ? service.durationMinutes
        : booking.durationMinutesSnapshot;
      const newEnd = new Date(newStart.getTime() + durationMinutes * 60_000);

      const timeZone = isValidTimeZone(booking.business.timezone)
        ? booking.business.timezone
        : "America/Bogota";

      const businessWindows = await tx.businessHours.findMany({
        where: { businessId, active: true },
        select: { weekday: true, startMinute: true, endMinute: true },
      });
      const staffWindows = await tx.staffAvailability.findMany({
        where: { staffId: newStaffId, active: true },
        select: { weekday: true, startMinute: true, endMinute: true },
      });
      const closures = await tx.businessClosure.findMany({
        where: {
          businessId,
          startsAt: { lt: newEnd },
          endsAt: { gt: newStart },
        },
        select: { startsAt: true, endsAt: true },
      });
      const timeOffs = await tx.timeOff.findMany({
        where: {
          staffId: newStaffId,
          startsAt: { lt: newEnd },
          endsAt: { gt: newStart },
        },
        select: { startsAt: true, endsAt: true },
      });

      const verdict = checkSlot({
        timeZone,
        startsAt: newStart,
        durationMinutes,
        businessWindows,
        staffWindows,
        closures: closures.map((item) => ({
          start: item.startsAt,
          end: item.endsAt,
        })),
        timeOffs: timeOffs.map((item) => ({
          start: item.startsAt,
          end: item.endsAt,
        })),
        now,
      });
      if (!verdict.ok) {
        return { kind: "unavailable" as const, reason: verdict.reason };
      }

      // UPDATE condicionado por versión y estado. Si el nuevo horario choca
      // con otra reserva, PostgreSQL lanza la violación de exclusión (409).
      const updated = await tx.booking.updateMany({
        where: {
          id,
          businessId,
          version: expectedVersion,
          status: { in: [...ACTIVE_STATUSES] },
        },
        data: {
          startsAt: newStart,
          endsAt: newEnd,
          serviceId: newServiceId,
          staffId: newStaffId,
          ...(serviceChanged
            ? {
                serviceNameSnapshot: service.name,
                durationMinutesSnapshot: service.durationMinutes,
                priceSnapshot: service.price,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return { kind: "stale" as const };

      await tx.bookingEvent.create({
        data: {
          businessId,
          bookingId: id,
          type: "MODIFIED",
          actorType: "USER",
          actorUserId: access.userId,
          fromStatus: booking.status,
          toStatus: booking.status,
          reason: reason.value,
          data: {
            before: {
              startsAt: booking.startsAt.toISOString(),
              endsAt: booking.endsAt.toISOString(),
              serviceId: booking.serviceId,
              staffId: booking.staffId,
              serviceName: booking.serviceNameSnapshot,
              price: booking.priceSnapshot.toString(),
            },
            after: {
              startsAt: newStart.toISOString(),
              endsAt: newEnd.toISOString(),
              serviceId: newServiceId,
              staffId: newStaffId,
              serviceName: serviceChanged
                ? service.name
                : booking.serviceNameSnapshot,
              price: (serviceChanged
                ? service.price
                : booking.priceSnapshot
              ).toString(),
            },
            ...(decision.kind === "override"
              ? { override: overrideJson(decision.override, access.userId) }
              : {}),
          },
        },
      });

      const result = await tx.booking.findFirst({
        where: { id, businessId },
        select: bookingSummarySelect,
      });
      return { kind: "ok" as const, booking: result };
    });

    switch (outcome.kind) {
      case "not_found":
        return sendError(
          response,
          404,
          "BOOKING_NOT_FOUND",
          "La reserva no existe.",
        );
      case "stale":
        return sendError(response, 409, "STALE_BOOKING", staleMessage);
      case "invalid_state":
        return sendError(
          response,
          409,
          "INVALID_STATE",
          "Solo se pueden modificar reservas pendientes o confirmadas.",
          { status: outcome.status },
        );
      case "started":
        return sendError(
          response,
          422,
          "BOOKING_ALREADY_STARTED",
          "La reserva ya comenzó y no se puede modificar.",
        );
      case "no_changes":
        return sendError(
          response,
          400,
          "NO_CHANGES",
          "Los datos enviados son iguales a los actuales.",
        );
      case "staff_forbidden":
        return sendError(
          response,
          403,
          "STAFF_CHANGE_NOT_ALLOWED",
          "Solo un propietario o administrador puede cambiar el empleado asignado.",
        );
      case "notice":
        return sendNoticeFailure(
          response,
          outcome.decision,
          "RESCHEDULE_NOTICE",
        );
      case "invalid_reference":
        return sendError(
          response,
          400,
          "INVALID_BOOKING_REFERENCE",
          "El servicio o empleado no existe, está inactivo o no corresponde al servicio.",
        );
      case "unavailable":
        return sendError(
          response,
          422,
          "SLOT_UNAVAILABLE",
          slotRejectionMessages[outcome.reason],
          { reason: outcome.reason },
        );
      case "ok":
        response.status(200).json({ data: outcome.booking });
    }
  } catch (error: unknown) {
    if (isBookingConflictError(error)) {
      return sendError(
        response,
        409,
        "BOOKING_CONFLICT",
        "Ese horario ya está ocupado para el empleado seleccionado.",
      );
    }
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Cambio de estado (confirmar, completar, no asistió, expirar)
// ---------------------------------------------------------------------------

const manualStatuses = [
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
  "EXPIRED",
] as const;
type ManualStatus = (typeof manualStatuses)[number];

bookingManagementRouter.post(
  "/bookings/:id/status",
  async (request, response) => {
    const id = request.params.id;
    if (!uuidPattern.test(id)) return badBookingId(response);

    const body: unknown = request.body;
    if (!isRecord(body)) {
      return sendError(
        response,
        400,
        "BAD_REQUEST",
        "El cuerpo debe ser un objeto JSON",
      );
    }

    if (body.status === "CANCELLED") {
      return sendError(
        response,
        400,
        "USE_CANCEL_ENDPOINT",
        "Para cancelar usa POST /bookings/:id/cancel, que aplica las reglas de aviso mínimo.",
      );
    }

    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    const reason = parseReason(body.reason);
    const status = manualStatuses.find((item) => item === body.status);
    if (expectedVersion === null || !reason.ok || !status) {
      return sendError(
        response,
        400,
        "BAD_REQUEST",
        "Revisa status (CONFIRMED, COMPLETED, NO_SHOW o EXPIRED), expectedVersion y reason.",
      );
    }
    const target: ManualStatus = status;

    const access = await resolveBookingAccess(request, response, id);
    if (!access) return;

    const now = new Date();

    const outcome = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id, businessId: access.businessId },
        select: { id: true, status: true, startsAt: true, version: true },
      });
      if (!booking) return { kind: "not_found" as const };
      if (booking.version !== expectedVersion)
        return { kind: "stale" as const };

      const from = booking.status as BookingStatusName;
      if (!canTransition(from, target)) {
        return { kind: "invalid_state" as const, status: booking.status };
      }
      if (
        requiresStartedBooking(target) &&
        booking.startsAt.getTime() > now.getTime()
      ) {
        return { kind: "not_started" as const };
      }

      const updated = await tx.booking.updateMany({
        where: {
          id,
          businessId: access.businessId,
          version: expectedVersion,
          status: from,
        },
        data: {
          status: target,
          version: { increment: 1 },
          ...(target === "CONFIRMED"
            ? { confirmedAt: now, holdExpiresAt: null }
            : {}),
        },
      });
      if (updated.count !== 1) return { kind: "stale" as const };

      await tx.bookingEvent.create({
        data: {
          businessId: access.businessId,
          bookingId: id,
          type: "STATUS_CHANGED",
          actorType: "USER",
          actorUserId: access.userId,
          fromStatus: from,
          toStatus: target,
          reason: reason.value,
          data: { before: { status: from }, after: { status: target } },
        },
      });

      const result = await tx.booking.findFirst({
        where: { id, businessId: access.businessId },
        select: bookingSummarySelect,
      });
      return { kind: "ok" as const, booking: result };
    });

    switch (outcome.kind) {
      case "not_found":
        return sendError(
          response,
          404,
          "BOOKING_NOT_FOUND",
          "La reserva no existe.",
        );
      case "stale":
        return sendError(response, 409, "STALE_BOOKING", staleMessage);
      case "invalid_state":
        return sendError(
          response,
          409,
          "INVALID_STATE",
          "Ese cambio de estado no está permitido desde el estado actual.",
          { status: outcome.status, requested: target },
        );
      case "not_started":
        return sendError(
          response,
          422,
          "BOOKING_NOT_STARTED",
          "Solo se puede marcar como completada o no asistió una reserva cuya hora ya llegó.",
        );
      case "ok":
        response.status(200).json({ data: outcome.booking });
    }
  },
);
