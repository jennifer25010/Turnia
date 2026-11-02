import { describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  cancelBooking,
  changeBookingStatus,
  describeApiError,
  getBookingDetail,
  getBusinessSettings,
  linkStaffUser,
  listStaff,
  parseBookingDetail,
  updateBooking,
  updateBusinessSettings,
} from "../../web/src/booking-admin-api.ts";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const detail = {
  id: "b1",
  status: "CONFIRMED",
  version: 3,
  startsAt: "2026-10-26T15:00:00.000Z",
  endsAt: "2026-10-26T15:30:00.000Z",
  business: { timezone: "America/Bogota" },
  staff: { displayName: "Ana" },
  events: [],
  permissions: { canOverrideNotice: true, canChangeStaff: true },
};

describe("cliente de gestión de reservas", () => {
  it("lee el detalle validando su formato", async () => {
    const request = vi
      .fn()
      .mockImplementation(async () => json({ data: detail }));
    const result = await getBookingDetail("b1", request);
    expect(result.version).toBe(3);
    expect(request.mock.calls[0][0]).toBe("/api/v1/bookings/b1");
  });

  it("rechaza un detalle con estado desconocido o formato inesperado", () => {
    expect(() => parseBookingDetail({ ...detail, status: "RARO" })).toThrow(
      "formato inesperado",
    );
    expect(() => parseBookingDetail(null)).toThrow(ApiRequestError);
  });

  it("cancela con POST enviando versión, motivo y override", async () => {
    const request = vi.fn().mockImplementation(async () => json({ data: {} }));
    await cancelBooking(
      "b1",
      { expectedVersion: 3, reason: "Aviso del cliente", override: true },
      request,
    );
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("/api/v1/bookings/b1/cancel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      expectedVersion: 3,
      reason: "Aviso del cliente",
      override: true,
    });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("modifica con PATCH y cambia de estado con POST", async () => {
    const request = vi.fn().mockImplementation(async () => json({ data: {} }));
    await updateBooking("b1", { expectedVersion: 3, staffId: "s2" }, request);
    expect(request.mock.calls[0][1].method).toBe("PATCH");
    await changeBookingStatus(
      "b1",
      { expectedVersion: 4, status: "COMPLETED" },
      request,
    );
    expect(request.mock.calls[1][0]).toBe("/api/v1/bookings/b1/status");
  });

  it("convierte los errores de la API en ApiRequestError con código y detalles", async () => {
    const request = vi.fn().mockResolvedValue(
      json(
        {
          error: {
            code: "NOTICE_REQUIRED",
            message: "No se cumple el aviso mínimo.",
            details: {
              requiredMinutes: 120,
              actualMinutes: 60,
              canOverride: true,
            },
          },
        },
        422,
      ),
    );
    await expect(
      cancelBooking("b1", { expectedVersion: 3 }, request),
    ).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 422,
      code: "NOTICE_REQUIRED",
      details: { requiredMinutes: 120, canOverride: true },
    });
  });

  it("describe los errores con mensajes claros", () => {
    expect(
      describeApiError(new ApiRequestError(409, "STALE_BOOKING", "x")),
    ).toContain("Recarga");
    expect(
      describeApiError(new ApiRequestError(409, "BOOKING_CONFLICT", "x")),
    ).toContain("ocuparse");
    expect(
      describeApiError(
        new ApiRequestError(422, "SLOT_UNAVAILABLE", "El negocio no atiende."),
      ),
    ).toBe("El negocio no atiende.");
    expect(describeApiError(new TypeError("fetch failed"))).toContain(
      "conectar",
    );
  });

  it("lee y actualiza las políticas del negocio", async () => {
    const settings = {
      cancellationNoticeMinutes: 120,
      rescheduleNoticeMinutes: 60,
    };
    const request = vi
      .fn()
      .mockImplementation(async () => json({ data: settings }));
    expect(await getBusinessSettings("biz", request)).toEqual(settings);
    expect(
      await updateBusinessSettings(
        "biz",
        { cancellationNoticeMinutes: 120 },
        request,
      ),
    ).toEqual(settings);
    expect(request.mock.calls[1][1].method).toBe("PATCH");
    await expect(
      getBusinessSettings(
        "biz",
        vi.fn().mockImplementation(async () => json({ data: { x: 1 } })),
      ),
    ).rejects.toThrow("formato inesperado");
  });

  it("lista empleados y vincula o desvincula cuentas", async () => {
    const staff = {
      id: "s1",
      displayName: "Ana",
      active: true,
      userId: null,
      user: null,
    };
    const request = vi
      .fn()
      .mockImplementation(async () => json({ data: [staff] }));
    expect(await listStaff("biz", request)).toEqual([staff]);
    expect(request.mock.calls[0][0]).toBe("/api/v1/staff?businessId=biz");

    const one = vi.fn().mockImplementation(async () => json({ data: staff }));
    await linkStaffUser("s1", "ana@negocio.co", one);
    expect(one.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(one.mock.calls[0][1].body)).toEqual({
      email: "ana@negocio.co",
    });
    await linkStaffUser("s1", null, one);
    expect(JSON.parse(one.mock.calls[1][1].body)).toEqual({ email: null });
  });
});
