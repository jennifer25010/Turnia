export type BookingStatusCode =
  "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | "EXPIRED";

export type BookingEventView = {
  id: string;
  type: "CREATED" | "MODIFIED" | "CANCELLED" | "STATUS_CHANGED";
  actorType: "USER" | "CUSTOMER" | "SYSTEM";
  fromStatus: BookingStatusCode | null;
  toStatus: BookingStatusCode | null;
  reason: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  actorUser: { fullName: string } | null;
};

export type BookingDetail = {
  id: string;
  status: BookingStatusCode;
  version: number;
  source: string;
  customerNameSnapshot: string;
  customerEmailSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  serviceId: string;
  serviceNameSnapshot: string;
  durationMinutesSnapshot: number;
  priceSnapshot: number | string;
  staffId: string;
  staff: { displayName: string };
  startsAt: string;
  endsAt: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  business: {
    timezone: string;
    cancellationNoticeMinutes: number;
    rescheduleNoticeMinutes: number;
  };
  events: BookingEventView[];
  historyAvailableFromStage2: boolean;
  permissions: { canOverrideNotice: boolean; canChangeStaff: boolean };
};

export type BusinessSettings = {
  cancellationNoticeMinutes: number;
  rescheduleNoticeMinutes: number;
};

export type StaffLink = {
  id: string;
  displayName: string;
  active: boolean;
  userId: string | null;
  user: { id: string; email: string; fullName: string } | null;
};

/** Error de la API con su código estable, para decidir qué mostrar. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const statuses: readonly string[] = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
  "EXPIRED",
];

async function call(
  url: string,
  init: RequestInit,
  request: typeof fetch,
): Promise<unknown> {
  const response = await request(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Se trata como respuesta inesperada.
  }

  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new ApiRequestError(
      response.status,
      typeof error.code === "string" ? error.code : "UNKNOWN_ERROR",
      typeof error.message === "string"
        ? error.message
        : `La API respondió con el código ${response.status}.`,
      isRecord(error.details) ? error.details : {},
    );
  }

  if (!isRecord(body) || !("data" in body)) {
    throw new ApiRequestError(
      response.status,
      "UNEXPECTED_RESPONSE",
      "El servidor respondió con un formato inesperado.",
    );
  }
  return body.data;
}

export function parseBookingDetail(value: unknown): BookingDetail {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string" ||
    !statuses.includes(value.status) ||
    typeof value.version !== "number" ||
    typeof value.startsAt !== "string" ||
    Number.isNaN(Date.parse(value.startsAt)) ||
    typeof value.endsAt !== "string" ||
    !isRecord(value.business) ||
    typeof value.business.timezone !== "string" ||
    !isRecord(value.staff) ||
    !Array.isArray(value.events) ||
    !isRecord(value.permissions)
  ) {
    throw new ApiRequestError(
      200,
      "UNEXPECTED_RESPONSE",
      "El servidor devolvió el detalle de la cita con un formato inesperado.",
    );
  }
  return value as unknown as BookingDetail;
}

const json = (body: unknown) => JSON.stringify(body);

export async function getBookingDetail(
  id: string,
  request: typeof fetch = fetch,
): Promise<BookingDetail> {
  return parseBookingDetail(
    await call(`/api/v1/bookings/${encodeURIComponent(id)}`, {}, request),
  );
}

export type CancelInput = {
  expectedVersion: number;
  reason?: string;
  override?: boolean;
};

export async function cancelBooking(
  id: string,
  input: CancelInput,
  request: typeof fetch = fetch,
): Promise<void> {
  await call(
    `/api/v1/bookings/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: json(input) },
    request,
  );
}

export type UpdateInput = {
  expectedVersion: number;
  startsAt?: string;
  serviceId?: string;
  staffId?: string;
  reason?: string;
  override?: boolean;
};

export async function updateBooking(
  id: string,
  input: UpdateInput,
  request: typeof fetch = fetch,
): Promise<void> {
  await call(
    `/api/v1/bookings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: json(input) },
    request,
  );
}

export type StatusInput = {
  expectedVersion: number;
  status: "CONFIRMED" | "COMPLETED" | "NO_SHOW" | "EXPIRED";
  reason?: string;
};

export async function changeBookingStatus(
  id: string,
  input: StatusInput,
  request: typeof fetch = fetch,
): Promise<void> {
  await call(
    `/api/v1/bookings/${encodeURIComponent(id)}/status`,
    { method: "POST", body: json(input) },
    request,
  );
}

export async function getBusinessSettings(
  businessId: string,
  request: typeof fetch = fetch,
): Promise<BusinessSettings> {
  const data = await call(
    `/api/v1/businesses/${encodeURIComponent(businessId)}/settings`,
    {},
    request,
  );
  return parseSettings(data);
}

export async function updateBusinessSettings(
  businessId: string,
  patch: Partial<BusinessSettings>,
  request: typeof fetch = fetch,
): Promise<BusinessSettings> {
  const data = await call(
    `/api/v1/businesses/${encodeURIComponent(businessId)}/settings`,
    { method: "PATCH", body: json(patch) },
    request,
  );
  return parseSettings(data);
}

function parseSettings(data: unknown): BusinessSettings {
  if (
    !isRecord(data) ||
    typeof data.cancellationNoticeMinutes !== "number" ||
    typeof data.rescheduleNoticeMinutes !== "number"
  ) {
    throw new ApiRequestError(
      200,
      "UNEXPECTED_RESPONSE",
      "El servidor devolvió las políticas con un formato inesperado.",
    );
  }
  return {
    cancellationNoticeMinutes: data.cancellationNoticeMinutes,
    rescheduleNoticeMinutes: data.rescheduleNoticeMinutes,
  };
}

function parseStaffLink(value: unknown): StaffLink {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.active !== "boolean"
  ) {
    throw new ApiRequestError(
      200,
      "UNEXPECTED_RESPONSE",
      "El servidor devolvió empleados con un formato inesperado.",
    );
  }
  return value as unknown as StaffLink;
}

export async function listStaff(
  businessId: string,
  request: typeof fetch = fetch,
): Promise<StaffLink[]> {
  const data = await call(
    `/api/v1/staff?businessId=${encodeURIComponent(businessId)}`,
    {},
    request,
  );
  if (!Array.isArray(data)) {
    throw new ApiRequestError(
      200,
      "UNEXPECTED_RESPONSE",
      "El servidor devolvió empleados con un formato inesperado.",
    );
  }
  return data.map(parseStaffLink);
}

/** Vincula (correo) o desvincula (null) la cuenta de un empleado. */
export async function linkStaffUser(
  staffId: string,
  email: string | null,
  request: typeof fetch = fetch,
): Promise<StaffLink> {
  return parseStaffLink(
    await call(
      `/api/v1/staff/${encodeURIComponent(staffId)}/user`,
      { method: "PUT", body: json({ email }) },
      request,
    ),
  );
}

/** Mensaje claro en español para un error de la API. */
export function describeApiError(error: unknown): string {
  if (error instanceof TypeError) {
    return "No fue posible conectar con la API. Revisa que el servidor esté iniciado.";
  }
  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error
      ? error.message
      : "Ocurrió un error inesperado.";
  }
  switch (error.code) {
    case "STALE_BOOKING":
      return "Alguien más modificó esta cita mientras la editabas. Recarga los datos y vuelve a intentarlo.";
    case "BOOKING_CONFLICT":
      return "Ese horario acaba de ocuparse. Elige otro de la lista actualizada.";
    case "INVALID_STATE":
      return "La cita ya no está en un estado que permita este cambio. Recarga los datos.";
    case "BOOKING_NOT_FOUND":
      return "La cita no existe o no tienes acceso a ella.";
    case "BOOKING_ALREADY_ENDED":
    case "BOOKING_ALREADY_STARTED":
    case "BOOKING_NOT_STARTED":
    case "SLOT_UNAVAILABLE":
    case "OVERRIDE_NOT_ALLOWED":
    case "STAFF_CHANGE_NOT_ALLOWED":
    case "USER_NOT_IN_BUSINESS":
    case "USER_ALREADY_LINKED":
    case "NOTICE_REQUIRED":
    case "REASON_REQUIRED":
    case "NO_CHANGES":
      return error.message;
    case "UNAUTHENTICATED":
      return "Tu sesión expiró. Inicia sesión de nuevo.";
    case "FORBIDDEN":
      return "No tienes permiso para realizar esta acción.";
    default:
      return error.message || "No se pudo completar la operación.";
  }
}
