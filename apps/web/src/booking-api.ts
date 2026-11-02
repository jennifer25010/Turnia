export type BookingCreatePayload = {
  businessId: string;
  serviceId: string;
  staffId: string;
  startsAt: string;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
};

const BOGOTA_TIME_ZONE = "America/Bogota";

export function bogotaLocalDateTimeToIso(
  date: string,
  time: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return null;
  const parsed = new Date(`${date}T${time}:00-05:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  const localTime = new Intl.DateTimeFormat("es-CO", {
    timeZone: BOGOTA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
  return localDate === date && localTime === time ? parsed.toISOString() : null;
}

export async function createApiBooking(
  payload: BookingCreatePayload,
  request: typeof fetch = fetch,
): Promise<unknown> {
  const response = await request("/api/v1/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    // Un cuerpo sin JSON se maneja como respuesta inesperada más abajo.
  }

  if (!response.ok) {
    const errorBody =
      typeof responseBody === "object" && responseBody !== null
        ? (responseBody as { error?: unknown }).error
        : null;
    const apiError =
      typeof errorBody === "object" && errorBody !== null
        ? (errorBody as { code?: unknown; message?: unknown })
        : null;
    if (response.status === 409)
      throw new Error(
        "Ese empleado ya tiene una cita en ese horario. Elige otra hora.",
      );
    if (apiError?.code === "INVALID_BOOKING_REFERENCE") {
      throw new Error(
        "El servicio o el empleado ya no está disponible. Actualiza el catálogo y vuelve a intentarlo.",
      );
    }
    if (typeof apiError?.message === "string")
      throw new Error(apiError.message);
    throw new Error(
      "No se pudo guardar la cita. Revisa los datos e inténtalo de nuevo.",
    );
  }

  if (
    typeof responseBody !== "object" ||
    responseBody === null ||
    !("data" in responseBody)
  ) {
    throw new Error(
      "El servidor respondió con un formato inesperado. Recarga las citas antes de reintentar.",
    );
  }
  return responseBody.data;
}

export type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
  /** Hora local del negocio, HH:MM. */
  time: string;
};

export type AvailabilityQuery = {
  businessId: string;
  serviceId: string;
  staffId: string;
  /** Fecha local del negocio, AAAA-MM-DD. */
  date: string;
  /** Al modificar una cita, su propio horario actual no debe bloquearla. */
  excludeBookingId?: string;
};

function isAvailabilitySlot(value: unknown): value is AvailabilitySlot {
  if (typeof value !== "object" || value === null) return false;
  const slot = value as Record<string, unknown>;
  return (
    typeof slot.startsAt === "string" &&
    Number.isFinite(Date.parse(slot.startsAt)) &&
    typeof slot.endsAt === "string" &&
    Number.isFinite(Date.parse(slot.endsAt)) &&
    typeof slot.time === "string" &&
    /^\d{2}:\d{2}$/.test(slot.time)
  );
}

/** Consulta los horarios libres que calcula el servidor para una fecha. */
export async function fetchAvailability(
  query: AvailabilityQuery,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<AvailabilitySlot[]> {
  const params = new URLSearchParams({
    businessId: query.businessId,
    serviceId: query.serviceId,
    staffId: query.staffId,
    date: query.date,
    ...(query.excludeBookingId
      ? { excludeBookingId: query.excludeBookingId }
      : {}),
  });
  const response = await request(`/api/v1/availability?${params.toString()}`, {
    ...(signal ? { signal } : {}),
    headers: { Accept: "application/json" },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Se trata como respuesta inesperada más abajo.
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { error?: { message?: unknown } }).error?.message ===
        "string"
        ? (body as { error: { message: string } }).error.message
        : `No se pudieron consultar los horarios (código ${response.status}).`;
    throw new Error(message);
  }

  const data =
    typeof body === "object" && body !== null
      ? (body as { data?: unknown }).data
      : null;
  const slots =
    typeof data === "object" && data !== null
      ? (data as { slots?: unknown }).slots
      : null;
  if (!Array.isArray(slots) || !slots.every(isAvailabilitySlot)) {
    throw new Error("El servidor devolvió horarios con un formato inesperado.");
  }
  return slots;
}
