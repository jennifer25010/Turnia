import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingDetailDialog from "./BookingDetailDialog";

const SERVICE_A = "caa733de-3c1a-4679-b2ea-5d9a79e792cb";
const SERVICE_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const STAFF_A = "cd5e9781-0edf-45e0-9e4f-3a32aef9b681";
const STAFF_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const services = [
  { id: SERVICE_A, name: "Corte", durationMinutes: 30, staff: [{ id: STAFF_A, displayName: "Ana" }, { id: STAFF_B, displayName: "Luis" }] },
  { id: SERVICE_B, name: "Tinte", durationMinutes: 90, staff: [{ id: STAFF_B, displayName: "Luis" }] },
];

const DAY = 86_400_000;
const startsAt = new Date(Date.now() + 3 * DAY);
startsAt.setUTCMinutes(0, 0, 0);
const endsAt = new Date(startsAt.getTime() + 30 * 60_000);

function detail(overrides: Record<string, unknown> = {}, perms = { canOverrideNotice: true, canChangeStaff: true }) {
  return {
    id: "b1", status: "CONFIRMED", version: 3, source: "PANEL",
    customerNameSnapshot: "Laura Pérez", customerEmailSnapshot: "laura@example.com", customerPhoneSnapshot: null,
    serviceId: SERVICE_A, serviceNameSnapshot: "Corte", durationMinutesSnapshot: 30, priceSnapshot: "25000",
    staffId: STAFF_A, staff: { displayName: "Ana" },
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    notes: null, cancelledAt: null, cancelReason: null, createdAt: new Date().toISOString(),
    business: { timezone: "America/Bogota", cancellationNoticeMinutes: 0, rescheduleNoticeMinutes: 0 },
    events: [], historyAvailableFromStage2: true, permissions: perms,
    ...overrides,
  };
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let routes: (url: string, method: string, body: unknown) => Response | undefined;

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const fail = (status: number, code: string, message: string, details = {}) =>
  new Response(JSON.stringify({ error: { code, message, details } }), { status });

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(input), method, body });
    return routes(String(input), method, body) ?? fail(500, "NO_ROUTE", `sin ruta ${method} ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(extra: Partial<Parameters<typeof BookingDetailDialog>[0]> = {}) {
  const props = { bookingId: "b1", businessId: "biz", services, onClose: vi.fn(), onChanged: vi.fn(), onSessionExpired: vi.fn(), ...extra };
  render(<BookingDetailDialog {...props} />);
  return props;
}

describe("BookingDetailDialog (interfaz)", () => {
  it("muestra el detalle y avisa que el historial de una cita anterior no está disponible", async () => {
    routes = () => ok(detail());
    mount();
    expect(await screen.findByText("Cita de Laura Pérez")).toBeTruthy();
    expect(screen.getByText(/anterior a la Etapa 2/)).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  });

  it("una cita cancelada no ofrece acciones y lo explica", async () => {
    routes = () => ok(detail({ status: "CANCELLED" }));
    mount();
    await screen.findByText("Cita de Laura Pérez");
    expect(screen.queryByRole("button", { name: "Cancelar cita" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modificar" })).toBeNull();
    expect(screen.getByText(/estado final/)).toBeTruthy();
  });

  it("cancela con confirmación, envía la versión y muestra el éxito", async () => {
    let current = detail();
    routes = (url, method) => {
      if (method === "POST" && url.endsWith("/cancel")) { current = detail({ status: "CANCELLED", version: 4 }); return ok({ id: "b1" }); }
      return ok(current);
    };
    const props = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar cita" }));
    expect(screen.getByText("¿Cancelar esta cita?")).toBeTruthy();
    await user.type(screen.getByLabelText(/Motivo/), "El cliente avisó");
    await user.click(screen.getByRole("button", { name: "Confirmar cancelación" }));

    expect(await screen.findByText(/fue cancelada y quedó registrada/)).toBeTruthy();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/v1/bookings/b1/cancel");
    expect(post.body).toEqual({ expectedVersion: 3, reason: "El cliente avisó" });
    expect(props.onChanged).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancelar cita" })).toBeNull());
  });

  it("STAFF: con aviso mínimo incumplido no puede confirmar ni omitirlo", async () => {
    const soon = new Date(Date.now() + 30 * 60_000);
    routes = () => ok(detail({ startsAt: soon.toISOString(), endsAt: new Date(soon.getTime() + 1_800_000).toISOString(),
      business: { timezone: "America/Bogota", cancellationNoticeMinutes: 120, rescheduleNoticeMinutes: 0 } },
      { canOverrideNotice: false, canChangeStaff: false }));
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar cita" }));
    expect(screen.getByText(/Solo un propietario o administrador puede omitirlo/)).toBeTruthy();
    expect(screen.queryByLabelText(/Omitir el aviso mínimo/)).toBeNull();
    expect((screen.getByRole("button", { name: "Confirmar cancelación" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("OWNER/ADMIN: omitir el aviso exige marcar la casilla y un motivo; envía override", async () => {
    const soon = new Date(Date.now() + 30 * 60_000);
    let sent: unknown;
    routes = (url, method, body) => {
      if (method === "POST") { sent = body; return ok({ id: "b1" }); }
      return ok(detail({ startsAt: soon.toISOString(), endsAt: new Date(soon.getTime() + 1_800_000).toISOString(),
        business: { timezone: "America/Bogota", cancellationNoticeMinutes: 120, rescheduleNoticeMinutes: 0 } }));
    };
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar cita" }));
    const confirmBtn = screen.getByRole("button", { name: "Confirmar cancelación" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);                       // sin casilla
    await user.click(screen.getByLabelText(/Omitir el aviso mínimo/));
    expect(confirmBtn.disabled).toBe(false);
    await user.type(screen.getByLabelText(/Motivo/), "abc");       // demasiado corto
    await user.click(confirmBtn);
    expect(await screen.findByText(/al menos 5 caracteres/)).toBeTruthy();
    expect(sent).toBeUndefined();                                   // no llegó al servidor
    await user.type(screen.getByLabelText(/Motivo/), "de");        // "abcde"
    await user.click(confirmBtn);
    await waitFor(() => expect(sent).toEqual({ expectedVersion: 3, reason: "abcde", override: true }));
  });

  it("versión desactualizada (409): muestra el mensaje y recarga el detalle", async () => {
    let gets = 0;
    routes = (url, method) => {
      if (method === "POST") return fail(409, "STALE_BOOKING", "x");
      gets += 1;
      return ok(detail({ version: gets === 1 ? 3 : 5 }));
    };
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar cita" }));
    await user.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByText(/Alguien más modificó esta cita/)).toBeTruthy();
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });

  it("sesión vencida (401) durante una acción vuelve a la pantalla de acceso", async () => {
    routes = (url, method) => (method === "POST" ? fail(401, "UNAUTHENTICATED", "x") : ok(detail()));
    const props = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar cita" }));
    await user.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalled());
  });

  it("modificar: consulta horarios excluyendo la propia cita y envía solo lo que cambió", async () => {
    const newSlot = new Date(startsAt.getTime() + 2 * 3_600_000);
    let patched: unknown;
    routes = (url, method, body) => {
      if (url.startsWith("/api/v1/availability")) {
        return ok({ slots: [{ startsAt: newSlot.toISOString(), endsAt: new Date(newSlot.getTime() + 1_800_000).toISOString(), time: "11:00" }] });
      }
      if (method === "PATCH") { patched = body; return ok({ id: "b1" }); }
      return ok(detail());
    };
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Modificar" }));
    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/v1/availability"))).toBe(true));
    const availability = calls.find((c) => c.url.startsWith("/api/v1/availability"))!.url;
    expect(availability).toContain("excludeBookingId=b1");
    expect(availability).toContain(`staffId=${STAFF_A}`);

    const save = screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);                              // sin horario elegido
    const select = await screen.findByLabelText("Hora disponible");
    await user.selectOptions(select, newSlot.toISOString());
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(patched).toEqual({ expectedVersion: 3, startsAt: newSlot.toISOString() }));
  });

  it("modificar como STAFF: no puede cambiar el empleado", async () => {
    routes = (url) => (url.startsWith("/api/v1/availability") ? ok({ slots: [] }) : ok(detail({}, { canOverrideNotice: false, canChangeStaff: false })));
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Modificar" }));
    expect((screen.getByLabelText("Empleado") as HTMLSelectElement).disabled).toBe(true);
    expect(await screen.findByText("Sin horarios disponibles")).toBeTruthy();
  });

  it("conflicto de horario al guardar: avisa y vuelve a consultar los horarios", async () => {
    const slot = new Date(startsAt.getTime() + 3_600_000);
    let availabilityCalls = 0;
    routes = (url, method) => {
      if (url.startsWith("/api/v1/availability")) { availabilityCalls += 1; return ok({ slots: [{ startsAt: slot.toISOString(), endsAt: new Date(slot.getTime() + 1_800_000).toISOString(), time: "10:00" }] }); }
      if (method === "PATCH") return fail(409, "BOOKING_CONFLICT", "x");
      return ok(detail());
    };
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Modificar" }));
    await user.selectOptions(await screen.findByLabelText("Hora disponible"), slot.toISOString());
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/acaba de ocuparse/)).toBeTruthy();
    await waitFor(() => expect(availabilityCalls).toBeGreaterThanOrEqual(2));
  });

  it("marcar como completada exige confirmación y envía la versión", async () => {
    const past = new Date(Date.now() - 3_600_000);
    let sent: unknown;
    routes = (url, method, body) => {
      if (method === "POST") { sent = body; return ok({ id: "b1" }); }
      return ok(detail({ startsAt: past.toISOString(), endsAt: new Date(past.getTime() + 1_800_000).toISOString() }));
    };
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Marcar completada/ }));
    const group = screen.getByRole("group", { name: "Confirmar cambio de estado" });
    expect(sent).toBeUndefined();
    await user.click(within(group).getByRole("button", { name: "Sí, confirmar" }));
    await waitFor(() => expect(sent).toEqual({ expectedVersion: 3, status: "COMPLETED" }));
  });

  it("el historial muestra la omisión del aviso con quién la autorizó", async () => {
    routes = () => ok(detail({ status: "CANCELLED", historyAvailableFromStage2: false, events: [
      { id: "e1", type: "CANCELLED", actorType: "USER", fromStatus: "CONFIRMED", toStatus: "CANCELLED", reason: "Emergencia",
        data: { override: { restriction: "CANCELLATION_NOTICE", requiredMinutes: 120, actualMinutes: 60, authorizedByUserId: "u1" } },
        createdAt: new Date().toISOString(), actorUser: { fullName: "Marta Gómez" } },
    ] }));
    mount();
    expect(await screen.findByText(/Se omitió el aviso mínimo de cancelación/)).toBeTruthy();
    expect(screen.getByText(/Autorizado por Marta Gómez/)).toBeTruthy();
    expect(screen.queryByText(/anterior a la Etapa 2/)).toBeNull();
  });

  it("Escape cierra el diálogo", async () => {
    routes = () => ok(detail());
    const props = mount();
    await screen.findByText("Cita de Laura Pérez");
    await userEvent.setup().keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });
});
