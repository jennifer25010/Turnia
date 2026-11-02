import { describe, expect, it, vi } from "vitest";
import {
  bogotaLocalDateTimeToIso,
  createApiBooking,
  fetchAvailability,
} from "../../web/src/booking-api.ts";

const validBooking = {
  id: "booking-uuid",
  status: "CONFIRMED",
  customerNameSnapshot: "Cliente",
  serviceNameSnapshot: "Corte",
  startsAt: "2026-10-25T15:00:00.000Z",
  endsAt: "2026-10-25T15:30:00.000Z",
};
const payload = {
  businessId: "758ad131-14b1-42e4-8d74-d093bb62c41b",
  serviceId: "caa733de-3c1a-4679-b2ea-5d9a79e792cb",
  staffId: "cd5e9781-0edf-45e0-9e4f-3a32aef9b681",
  startsAt: "2026-10-25T15:00:00.000Z",
  name: "Cliente",
  email: "cliente@example.com",
  phone: "3001234567",
  notes: "Primera visita",
};
const response = (body, status = 201) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("cliente de creación de reservas", () => {
  it("convierte la hora local de Bogotá a UTC sin desplazarla", () => {
    expect(bogotaLocalDateTimeToIso("2026-10-25", "10:00")).toBe(
      "2026-10-25T15:00:00.000Z",
    );
    expect(bogotaLocalDateTimeToIso("2026-02-30", "10:00")).toBeNull();
  });

  it("envía UUID y campos opcionales al endpoint, y devuelve la reserva confirmada", async () => {
    const request = vi.fn().mockResolvedValue(response({ data: validBooking }));
    const created = await createApiBooking(payload, request);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "/api/v1/bookings",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(created).toEqual(validBooking);
  });

  it("traduce conflictos HTTP 409", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        response(
          { error: { code: "BOOKING_CONFLICT", message: "conflict" } },
          409,
        ),
      );
    await expect(createApiBooking(payload, request)).rejects.toThrow(
      "Ese empleado ya tiene una cita en ese horario.",
    );
  });

  it("explica referencias inválidas y errores de validación", async () => {
    const invalidReference = vi
      .fn()
      .mockResolvedValue(
        response(
          { error: { code: "INVALID_BOOKING_REFERENCE", message: "invalid" } },
          400,
        ),
      );
    const invalidInput = vi
      .fn()
      .mockResolvedValue(
        response(
          { error: { code: "BAD_REQUEST", message: "Revisa el nombre" } },
          400,
        ),
      );
    await expect(createApiBooking(payload, invalidReference)).rejects.toThrow(
      "El servicio o el empleado ya no está disponible.",
    );
    await expect(createApiBooking(payload, invalidInput)).rejects.toThrow(
      "Revisa el nombre",
    );
  });

  it("rechaza una respuesta exitosa sin el envoltorio esperado", async () => {
    const request = vi.fn().mockResolvedValue(response({ success: true }));
    await expect(createApiBooking(payload, request)).rejects.toThrow(
      "formato inesperado",
    );
  });
});

describe("cliente de disponibilidad", () => {
  const query = {
    businessId: "758ad131-14b1-42e4-8d74-d093bb62c41b",
    serviceId: "caa733de-3c1a-4679-b2ea-5d9a79e792cb",
    staffId: "cd5e9781-0edf-45e0-9e4f-3a32aef9b681",
    date: "2026-10-26",
  };
  const slot = {
    startsAt: "2026-10-26T13:00:00.000Z",
    endsAt: "2026-10-26T13:30:00.000Z",
    time: "08:00",
  };

  it("consulta los horarios con los parámetros en la URL", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(response({ data: { slots: [slot] } }, 200));
    const slots = await fetchAvailability(query, request);
    expect(slots).toEqual([slot]);
    const url = request.mock.calls[0][0];
    expect(url).toContain("/api/v1/availability?");
    expect(url).toContain(`staffId=${query.staffId}`);
    expect(url).toContain("date=2026-10-26");
  });

  it("propaga el mensaje de error de la API", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        response({ error: { message: "Revisa la fecha" } }, 400),
      );
    await expect(fetchAvailability(query, request)).rejects.toThrow(
      "Revisa la fecha",
    );
  });

  it("rechaza horarios con formato inesperado", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(response({ data: { slots: [{ time: "8am" }] } }, 200));
    await expect(fetchAvailability(query, request)).rejects.toThrow(
      "formato inesperado",
    );
  });
});
