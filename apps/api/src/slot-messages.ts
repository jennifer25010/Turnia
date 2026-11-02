import type { SlotRejectionReason } from "./availability.js";

export const slotRejectionMessages: Record<SlotRejectionReason, string> = {
  INVALID_START: "La hora de inicio debe ser exacta (sin segundos).",
  PAST: "No se puede reservar en un horario que ya pasó.",
  OUTSIDE_BUSINESS_HOURS: "El negocio no atiende en ese horario.",
  OUTSIDE_STAFF_AVAILABILITY: "El empleado no trabaja en ese horario.",
  BUSINESS_CLOSED: "El negocio está cerrado en ese horario.",
  STAFF_TIME_OFF: "El empleado tiene una ausencia o descanso en ese horario.",
};
