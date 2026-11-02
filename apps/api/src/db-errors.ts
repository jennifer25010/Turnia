/**
 * Detecta la violación de la restricción de exclusión que impide que un mismo
 * empleado tenga dos reservas activas solapadas
 * (`booking_staff_no_overlapping_active`, SQLSTATE 23P01).
 *
 * Prisma no expone un código propio para las restricciones de exclusión, así
 * que se inspecciona el texto del error.
 */
export function isBookingConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  const meta = (error as { meta?: unknown }).meta;
  const text = [
    error.message,
    typeof code === "string" ? code : "",
    meta ? JSON.stringify(meta) : "",
  ].join(" ");
  return (
    text.includes("23P01") ||
    text.includes("booking_staff_no_overlapping_active")
  );
}

/** Violación de unicidad de Prisma (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && (error as { code?: unknown }).code === "P2002"
  );
}
