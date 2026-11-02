import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import {
  ApiRequestError,
  cancelBooking,
  changeBookingStatus,
  describeApiError,
  getBookingDetail,
  updateBooking,
  type BookingDetail,
  type BookingEventView,
  type BookingStatusCode,
} from "./booking-admin-api.js";
import { fetchAvailability, type AvailabilitySlot } from "./booking-api.js";

export type CatalogService = {
  id: string;
  name: string;
  durationMinutes: number;
  staff: { id: string; displayName: string }[];
};

type Props = {
  bookingId: string;
  businessId: string;
  services: CatalogService[];
  onClose: () => void;
  /** Se invoca tras un cambio exitoso para refrescar el listado. */
  onChanged: () => void;
  onSessionExpired: () => void;
};

const STATUS_LABEL: Record<BookingStatusCode, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  COMPLETED: "Completada",
  NO_SHOW: "No asistió",
  EXPIRED: "Expirada",
};

const MIN_OVERRIDE_REASON = 5;

function formatDateTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function localDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function formatMinutes(minutes: number) {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? "día" : "días"}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

function describeEvent(event: BookingEventView, timeZone: string) {
  const when = (value: unknown) =>
    typeof value === "string" ? formatDateTime(value, timeZone) : "—";
  const data = event.data ?? {};
  const before = (data.before ?? {}) as Record<string, unknown>;
  const after = (data.after ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case "CREATED":
      return "Reserva creada";
    case "CANCELLED":
      return "Reserva cancelada";
    case "STATUS_CHANGED":
      return `Estado: ${event.fromStatus ? STATUS_LABEL[event.fromStatus] : "—"} → ${
        event.toStatus ? STATUS_LABEL[event.toStatus] : "—"
      }`;
    case "MODIFIED": {
      const parts: string[] = [];
      if (before.startsAt !== after.startsAt) {
        parts.push(
          `Horario: ${when(before.startsAt)} → ${when(after.startsAt)}`,
        );
      }
      if (before.serviceId !== after.serviceId) {
        parts.push(
          `Servicio: ${String(before.serviceName ?? "—")} → ${String(after.serviceName ?? "—")}`,
        );
      }
      if (before.staffId !== after.staffId) parts.push("Empleado reasignado");
      return parts.length > 0
        ? `Reserva modificada. ${parts.join(". ")}`
        : "Reserva modificada";
    }
  }
}

function overrideNote(event: BookingEventView) {
  const override = event.data?.override as
    | { restriction?: string; requiredMinutes?: number; actualMinutes?: number }
    | undefined;
  if (!override) return null;
  const what =
    override.restriction === "CANCELLATION_NOTICE"
      ? "aviso mínimo de cancelación"
      : "aviso mínimo de modificación";
  return `Se omitió el ${what} (exigido: ${formatMinutes(override.requiredMinutes ?? 0)}, real: ${formatMinutes(Math.max(override.actualMinutes ?? 0, 0))}). Autorizado por ${event.actorUser?.fullName ?? "un administrador"}.`;
}

type Mode = "view" | "cancel" | "modify";

export default function BookingDetailDialog({
  bookingId,
  businessId,
  services,
  onClose,
  onChanged,
  onSessionExpired,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pendingStatus, setPendingStatus] = useState<
    "CONFIRMED" | "COMPLETED" | "NO_SHOW" | "EXPIRED" | null
  >(null);

  // Cancelar
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOverride, setCancelOverride] = useState(false);

  // Modificar
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [slotsError, setSlotsError] = useState("");
  const [slotsReloadKey, setSlotsReloadKey] = useState(0);
  const [slotStart, setSlotStart] = useState("");
  const [modifyReason, setModifyReason] = useState("");
  const [modifyOverride, setModifyOverride] = useState(false);

  const handleFailure = useCallback(
    (caught: unknown) => {
      if (caught instanceof ApiRequestError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setError(describeApiError(caught));
    },
    [onSessionExpired],
  );

  // Foco accesible: al abrir se enfoca el diálogo y al cerrar se devuelve el
  // foco al elemento que lo abrió.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    getBookingDetail(bookingId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiRequestError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setLoadError(describeApiError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId, reloadKey, onSessionExpired]);

  const timeZone = detail?.business.timezone ?? "America/Bogota";
  const now = Date.now();
  const isActive =
    detail?.status === "PENDING" || detail?.status === "CONFIRMED";
  const hasStarted = detail ? Date.parse(detail.startsAt) <= now : false;
  const hasEnded = detail ? Date.parse(detail.endsAt) <= now : false;

  const minutesUntilStart = detail
    ? Math.floor((Date.parse(detail.startsAt) - now) / 60_000)
    : 0;
  const cancelViolates =
    !!detail &&
    detail.business.cancellationNoticeMinutes > 0 &&
    minutesUntilStart < detail.business.cancellationNoticeMinutes;
  const modifyViolates =
    !!detail &&
    detail.business.rescheduleNoticeMinutes > 0 &&
    minutesUntilStart < detail.business.rescheduleNoticeMinutes;

  function startMode(next: Mode) {
    if (!detail) return;
    setError("");
    setSuccess("");
    setPendingStatus(null);
    setMode(next);
    if (next === "cancel") {
      setCancelReason("");
      setCancelOverride(false);
    }
    if (next === "modify") {
      setServiceId(detail.serviceId);
      setStaffId(detail.staffId);
      setDate(localDate(detail.startsAt, detail.business.timezone));
      setSlotStart("");
      setModifyReason("");
      setModifyOverride(false);
    }
  }

  // Horarios libres para la modificación (excluye la propia cita).
  useEffect(() => {
    if (mode !== "modify" || !serviceId || !staffId || !date || !detail) {
      setSlots(null);
      return;
    }
    const controller = new AbortController();
    setSlots(null);
    setSlotsError("");
    fetchAvailability(
      { businessId, serviceId, staffId, date, excludeBookingId: detail.id },
      fetch,
      controller.signal,
    )
      .then((available) => {
        setSlots(available);
        setSlotStart((current) =>
          available.some((slot) => slot.startsAt === current) ? current : "",
        );
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setSlots([]);
        setSlotsError(describeApiError(caught));
      });
    return () => controller.abort();
  }, [mode, businessId, serviceId, staffId, date, detail, slotsReloadKey]);

  const staffOptions = useMemo(
    () => services.find((service) => service.id === serviceId)?.staff ?? [],
    [services, serviceId],
  );
  const staffOffersService = staffOptions.some((item) => item.id === staffId);

  async function run(action: () => Promise<void>, successMessage: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(successMessage);
      setMode("view");
      setPendingStatus(null);
      setReloadKey((key) => key + 1);
      onChanged();
    } catch (caught) {
      handleFailure(caught);
      if (caught instanceof ApiRequestError) {
        // Datos desactualizados: se recargan para mostrar la versión vigente.
        if (
          caught.code === "STALE_BOOKING" ||
          caught.code === "INVALID_STATE"
        ) {
          setReloadKey((key) => key + 1);
          setMode("view");
        }
        if (caught.code === "BOOKING_CONFLICT") {
          setSlotsReloadKey((key) => key + 1);
          setSlotStart("");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function submitCancel() {
    if (!detail) return;
    const reason = cancelReason.trim();
    if (
      cancelViolates &&
      cancelOverride &&
      reason.length < MIN_OVERRIDE_REASON
    ) {
      setError(
        `Para omitir el aviso mínimo escribe un motivo de al menos ${MIN_OVERRIDE_REASON} caracteres.`,
      );
      return;
    }
    void run(
      () =>
        cancelBooking(detail.id, {
          expectedVersion: detail.version,
          ...(reason ? { reason } : {}),
          ...(cancelViolates && cancelOverride ? { override: true } : {}),
        }),
      "La cita fue cancelada y quedó registrada en el historial.",
    );
  }

  function submitModify() {
    if (!detail) return;
    const slot = slots?.find((item) => item.startsAt === slotStart);
    if (!slot) {
      setError("Selecciona uno de los horarios disponibles.");
      return;
    }
    const reason = modifyReason.trim();
    if (
      modifyViolates &&
      modifyOverride &&
      reason.length < MIN_OVERRIDE_REASON
    ) {
      setError(
        `Para omitir el aviso mínimo escribe un motivo de al menos ${MIN_OVERRIDE_REASON} caracteres.`,
      );
      return;
    }
    const startChanged =
      Date.parse(slot.startsAt) !== Date.parse(detail.startsAt);
    const serviceChanged = serviceId !== detail.serviceId;
    const staffChanged = staffId !== detail.staffId;
    if (!startChanged && !serviceChanged && !staffChanged) {
      setError("No hay cambios: elige otro horario, servicio o empleado.");
      return;
    }
    void run(
      () =>
        updateBooking(detail.id, {
          expectedVersion: detail.version,
          ...(startChanged ? { startsAt: slot.startsAt } : {}),
          ...(serviceChanged ? { serviceId } : {}),
          ...(staffChanged ? { staffId } : {}),
          ...(reason ? { reason } : {}),
          ...(modifyViolates && modifyOverride ? { override: true } : {}),
        }),
      "La cita fue modificada y el cambio quedó registrado en el historial.",
    );
  }

  function submitStatus() {
    if (!detail || !pendingStatus) return;
    const target = pendingStatus;
    void run(
      () =>
        changeBookingStatus(detail.id, {
          expectedVersion: detail.version,
          status: target,
        }),
      `La cita se marcó como "${STATUS_LABEL[target]}".`,
    );
  }

  const statusActions: {
    status: NonNullable<typeof pendingStatus>;
    label: string;
  }[] = !detail
    ? []
    : detail.status === "PENDING"
      ? [
          { status: "CONFIRMED", label: "Confirmar" },
          { status: "EXPIRED", label: "Marcar expirada" },
        ]
      : detail.status === "CONFIRMED" && hasStarted
        ? [
            { status: "COMPLETED", label: "Marcar completada" },
            { status: "NO_SHOW", label: "Marcar no asistió" },
          ]
        : [];

  const overrideAllowed = !!detail?.permissions.canOverrideNotice;

  return (
    <div
      className="bd-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        ref={dialogRef}
        className="bd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bd-title"
        tabIndex={-1}
      >
        <header className="bd-header">
          <div>
            <h2 id="bd-title">
              {detail ? `Cita de ${detail.customerNameSnapshot}` : "Cita"}
            </h2>
            {detail && (
              <span className={`bd-pill bd-${detail.status.toLowerCase()}`}>
                {STATUS_LABEL[detail.status]}
              </span>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="bd-body" aria-busy={busy}>
          {!detail && !loadError && <p role="status">Cargando la cita…</p>}
          {loadError && (
            <div className="bd-alert" role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              <span>{loadError}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Reintentar
              </button>
            </div>
          )}

          {success && (
            <div className="bd-success" role="status">
              <CircleCheck size={17} aria-hidden="true" />
              <span>{success}</span>
            </div>
          )}
          {error && (
            <div className="bd-alert" role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {detail && (
            <>
              <dl className="bd-grid">
                <div>
                  <dt>Servicio</dt>
                  <dd>
                    {detail.serviceNameSnapshot} (
                    {detail.durationMinutesSnapshot} min)
                  </dd>
                </div>
                <div>
                  <dt>Empleado</dt>
                  <dd>{detail.staff.displayName}</dd>
                </div>
                <div>
                  <dt>Inicio</dt>
                  <dd>{formatDateTime(detail.startsAt, timeZone)}</dd>
                </div>
                <div>
                  <dt>Fin</dt>
                  <dd>{formatDateTime(detail.endsAt, timeZone)}</dd>
                </div>
                {detail.customerEmailSnapshot && (
                  <div>
                    <dt>Correo</dt>
                    <dd>{detail.customerEmailSnapshot}</dd>
                  </div>
                )}
                {detail.customerPhoneSnapshot && (
                  <div>
                    <dt>Teléfono</dt>
                    <dd>{detail.customerPhoneSnapshot}</dd>
                  </div>
                )}
                {detail.notes && (
                  <div className="bd-wide">
                    <dt>Notas</dt>
                    <dd>{detail.notes}</dd>
                  </div>
                )}
                {detail.cancelReason && (
                  <div className="bd-wide">
                    <dt>Motivo de cancelación</dt>
                    <dd>{detail.cancelReason}</dd>
                  </div>
                )}
              </dl>

              {mode === "view" && (
                <section aria-label="Acciones">
                  {isActive && !hasEnded ? (
                    <div className="bd-actions">
                      {!hasStarted && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => startMode("modify")}
                          disabled={busy}
                        >
                          Modificar
                        </button>
                      )}
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => startMode("cancel")}
                        disabled={busy}
                      >
                        Cancelar cita
                      </button>
                      {statusActions.map((action) => (
                        <button
                          key={action.status}
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setSuccess("");
                            setPendingStatus(action.status);
                          }}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : isActive && hasEnded ? (
                    <p className="field-hint">
                      La cita ya terminó. Usa «Marcar completada» o «Marcar no
                      asistió» para cerrarla.
                    </p>
                  ) : (
                    <p className="field-hint">
                      Esta cita está en un estado final y ya no admite cambios.
                    </p>
                  )}
                  {isActive && hasEnded && statusActions.length > 0 && (
                    <div className="bd-actions">
                      {statusActions.map((action) => (
                        <button
                          key={action.status}
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setSuccess("");
                            setPendingStatus(action.status);
                          }}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {pendingStatus && (
                    <div
                      className="bd-confirm"
                      role="group"
                      aria-label="Confirmar cambio de estado"
                    >
                      <p>
                        ¿Marcar esta cita como{" "}
                        <strong>{STATUS_LABEL[pendingStatus]}</strong>? Quedará
                        registrado en el historial.
                      </p>
                      <div className="bd-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={submitStatus}
                          disabled={busy}
                        >
                          {busy ? "Guardando…" : "Sí, confirmar"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setPendingStatus(null)}
                          disabled={busy}
                        >
                          Volver
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {mode === "cancel" && (
                <section className="bd-confirm" aria-label="Cancelar cita">
                  <h3>¿Cancelar esta cita?</h3>
                  <p>
                    El horario quedará libre y la cancelación no se puede
                    deshacer. El historial conserva quién y cuándo la canceló.
                  </p>
                  {cancelViolates && (
                    <div className="bd-alert" role="alert">
                      <CircleAlert size={17} aria-hidden="true" />
                      <span>
                        Esta cita empieza en{" "}
                        {formatMinutes(Math.max(minutesUntilStart, 0))} y el
                        negocio exige un aviso mínimo de{" "}
                        {formatMinutes(
                          detail.business.cancellationNoticeMinutes,
                        )}{" "}
                        para cancelar.
                        {overrideAllowed
                          ? " Como administrador puedes omitirlo indicando un motivo."
                          : " Solo un propietario o administrador puede omitirlo."}
                      </span>
                    </div>
                  )}
                  {cancelViolates && overrideAllowed && (
                    <label className="bd-check">
                      <input
                        type="checkbox"
                        checked={cancelOverride}
                        onChange={(e) => setCancelOverride(e.target.checked)}
                      />
                      Omitir el aviso mínimo (queda registrado con mi nombre)
                    </label>
                  )}
                  <label className="bd-field">
                    Motivo{" "}
                    {cancelViolates && cancelOverride
                      ? "(obligatorio)"
                      : "(opcional)"}
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      required={cancelViolates && cancelOverride}
                    />
                  </label>
                  <div className="bd-actions">
                    <button
                      type="button"
                      className="danger-button"
                      onClick={submitCancel}
                      disabled={
                        busy ||
                        (cancelViolates && !overrideAllowed) ||
                        (cancelViolates && !cancelOverride)
                      }
                    >
                      {busy ? "Cancelando…" : "Confirmar cancelación"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setMode("view")}
                      disabled={busy}
                    >
                      Volver
                    </button>
                  </div>
                </section>
              )}

              {mode === "modify" && (
                <section className="bd-confirm" aria-label="Modificar cita">
                  <h3>Modificar cita</h3>
                  {modifyViolates && (
                    <div className="bd-alert" role="alert">
                      <CircleAlert size={17} aria-hidden="true" />
                      <span>
                        El negocio exige un aviso mínimo de{" "}
                        {formatMinutes(detail.business.rescheduleNoticeMinutes)}{" "}
                        para modificar y esta cita empieza en{" "}
                        {formatMinutes(Math.max(minutesUntilStart, 0))}.
                        {overrideAllowed
                          ? " Puedes omitirlo indicando un motivo."
                          : " Solo un propietario o administrador puede omitirlo."}
                      </span>
                    </div>
                  )}
                  <div className="bd-form-grid">
                    <label className="bd-field">
                      Servicio
                      <select
                        value={serviceId}
                        onChange={(e) => {
                          const next = e.target.value;
                          setServiceId(next);
                          const offered =
                            services.find((s) => s.id === next)?.staff ?? [];
                          if (
                            !offered.some((item) => item.id === staffId) &&
                            detail.permissions.canChangeStaff
                          ) {
                            setStaffId(offered[0]?.id ?? "");
                          }
                        }}
                      >
                        {services.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name} ({service.durationMinutes} min)
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="bd-field">
                      Empleado
                      <select
                        value={staffId}
                        disabled={!detail.permissions.canChangeStaff}
                        onChange={(e) => setStaffId(e.target.value)}
                      >
                        {staffOptions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName}
                          </option>
                        ))}
                        {!staffOffersService && (
                          <option value={staffId}>
                            {detail.staff.displayName}
                          </option>
                        )}
                      </select>
                    </label>
                    <label className="bd-field">
                      Fecha
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => {
                          setDate(e.target.value);
                          setSlotStart("");
                        }}
                        required
                      />
                    </label>
                    <label className="bd-field">
                      Hora disponible
                      <select
                        value={slotStart}
                        onChange={(e) => setSlotStart(e.target.value)}
                        disabled={!slots || slots.length === 0}
                        required
                      >
                        <option value="">
                          {slots === null && !slotsError
                            ? "Consultando horarios…"
                            : slots?.length === 0
                              ? "Sin horarios disponibles"
                              : "Selecciona un horario"}
                        </option>
                        {slots?.map((slot) => (
                          <option key={slot.startsAt} value={slot.startsAt}>
                            {slot.time}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {!staffOffersService && (
                    <p className="field-hint" role="status">
                      {detail.permissions.canChangeStaff
                        ? "Elige un empleado que realice este servicio."
                        : "Tu perfil no realiza ese servicio; elige otro servicio."}
                    </p>
                  )}
                  {slotsError && (
                    <div className="bd-alert" role="alert">
                      <CircleAlert size={17} aria-hidden="true" />
                      <span>{slotsError}</span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSlotsReloadKey((k) => k + 1)}
                      >
                        Reintentar
                      </button>
                    </div>
                  )}
                  {modifyViolates && overrideAllowed && (
                    <label className="bd-check">
                      <input
                        type="checkbox"
                        checked={modifyOverride}
                        onChange={(e) => setModifyOverride(e.target.checked)}
                      />
                      Omitir el aviso mínimo (queda registrado con mi nombre)
                    </label>
                  )}
                  <label className="bd-field">
                    Motivo{" "}
                    {modifyViolates && modifyOverride
                      ? "(obligatorio)"
                      : "(opcional)"}
                    <textarea
                      rows={2}
                      maxLength={500}
                      value={modifyReason}
                      onChange={(e) => setModifyReason(e.target.value)}
                    />
                  </label>
                  <div className="bd-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={submitModify}
                      disabled={
                        busy ||
                        !slotStart ||
                        !staffOffersService ||
                        (modifyViolates && !modifyOverride)
                      }
                    >
                      {busy ? "Guardando…" : "Guardar cambios"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setMode("view")}
                      disabled={busy}
                    >
                      Volver
                    </button>
                  </div>
                </section>
              )}

              <section aria-labelledby="bd-history-title">
                <h3 id="bd-history-title">Historial</h3>
                {detail.historyAvailableFromStage2 && (
                  <p className="field-hint">
                    Esta cita es anterior a la Etapa 2: su historial completo no
                    está disponible. Los cambios se registran desde ahora.
                  </p>
                )}
                {detail.events.length === 0 ? (
                  <p className="field-hint">
                    Todavía no hay eventos registrados.
                  </p>
                ) : (
                  <ol className="bd-timeline">
                    {detail.events.map((event) => {
                      const note = overrideNote(event);
                      return (
                        <li key={event.id}>
                          <strong>{describeEvent(event, timeZone)}</strong>
                          <span className="bd-meta">
                            {formatDateTime(event.createdAt, timeZone)} ·{" "}
                            {event.actorUser?.fullName ??
                              (event.actorType === "SYSTEM"
                                ? "Sistema"
                                : "Usuario")}
                          </span>
                          {event.reason && <span>Motivo: {event.reason}</span>}
                          {note && <span className="bd-override">{note}</span>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
