import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import {
  ApiRequestError,
  describeApiError,
  getBusinessSettings,
  linkStaffUser,
  listStaff,
  updateBusinessSettings,
  type StaffLink,
} from "./booking-admin-api.js";

type PanelProps = {
  businessId: string;
  onSessionExpired: () => void;
};

const MAX_MINUTES = 43_200;

function describeMinutes(value: string) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0) return "";
  if (minutes === 0) return "Sin restricción";
  if (minutes % 1440 === 0) return `${minutes / 1440} día(s)`;
  if (minutes % 60 === 0) return `${minutes / 60} hora(s)`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function useFailureHandler(onSessionExpired: () => void) {
  return useCallback(
    (caught: unknown): string => {
      if (caught instanceof ApiRequestError && caught.status === 401) {
        onSessionExpired();
        return "";
      }
      return describeApiError(caught);
    },
    [onSessionExpired],
  );
}

export function BookingPolicyPanel({
  businessId,
  onSessionExpired,
}: PanelProps) {
  const failure = useFailureHandler(onSessionExpired);
  const [cancelMinutes, setCancelMinutes] = useState("");
  const [rescheduleMinutes, setRescheduleMinutes] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    getBusinessSettings(businessId)
      .then((settings) => {
        if (cancelled) return;
        setCancelMinutes(String(settings.cancellationNoticeMinutes));
        setRescheduleMinutes(String(settings.rescheduleNoticeMinutes));
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(failure(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, failure]);

  const valid = (value: string) =>
    /^\d+$/.test(value) && Number(value) <= MAX_MINUTES;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSuccess("");
    if (!valid(cancelMinutes) || !valid(rescheduleMinutes)) {
      setError(`Escribe minutos enteros entre 0 y ${MAX_MINUTES} (30 días).`);
      return;
    }
    setSaving(true);
    try {
      const saved = await updateBusinessSettings(businessId, {
        cancellationNoticeMinutes: Number(cancelMinutes),
        rescheduleNoticeMinutes: Number(rescheduleMinutes),
      });
      setCancelMinutes(String(saved.cancellationNoticeMinutes));
      setRescheduleMinutes(String(saved.rescheduleNoticeMinutes));
      setSuccess("Políticas guardadas.");
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="policy-title">
      <h3 id="policy-title">Reglas de cancelación y modificación</h3>
      <p className="field-hint">
        Tiempo mínimo, en minutos, que debe faltar para la cita. El personal con
        rol de propietario o administrador puede omitir el aviso indicando un
        motivo, que queda registrado en el historial; los empleados no. Usa 0
        para no restringir.
      </p>
      <form onSubmit={save} className="settings-form">
        <label className="bd-field">
          Aviso mínimo para cancelar (minutos)
          <input
            inputMode="numeric"
            value={cancelMinutes}
            disabled={!loaded}
            onChange={(e) => setCancelMinutes(e.target.value)}
          />
          <span className="field-hint">{describeMinutes(cancelMinutes)}</span>
        </label>
        <label className="bd-field">
          Aviso mínimo para modificar (minutos)
          <input
            inputMode="numeric"
            value={rescheduleMinutes}
            disabled={!loaded}
            onChange={(e) => setRescheduleMinutes(e.target.value)}
          />
          <span className="field-hint">
            {describeMinutes(rescheduleMinutes)}
          </span>
        </label>
        {error && (
          <div className="bd-alert" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="bd-success" role="status">
            <CircleCheck size={17} aria-hidden="true" />
            <span>{success}</span>
          </div>
        )}
        <button
          type="submit"
          className="primary-button"
          disabled={!loaded || saving}
        >
          {saving ? "Guardando…" : "Guardar políticas"}
        </button>
      </form>
    </section>
  );
}

export function StaffLinksPanel({ businessId, onSessionExpired }: PanelProps) {
  const failure = useFailureHandler(onSessionExpired);
  const [staff, setStaff] = useState<StaffLink[] | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    listStaff(businessId)
      .then((list) => {
        if (!cancelled) setStaff(list);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(failure(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, failure]);

  async function change(member: StaffLink, email: string | null) {
    if (busyId) return;
    setBusyId(member.id);
    setError("");
    setSuccess("");
    try {
      const updated = await linkStaffUser(member.id, email);
      setStaff((current) =>
        current
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : current,
      );
      setEmails((current) => ({ ...current, [member.id]: "" }));
      setSuccess(
        email
          ? `${member.displayName} quedó vinculado a ${updated.user?.email ?? email}.`
          : `${member.displayName} quedó sin cuenta vinculada.`,
      );
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="staff-links-title">
      <h3 id="staff-links-title">Empleados y cuentas</h3>
      <p className="field-hint">
        Un empleado con rol STAFF solo ve y gestiona las citas del perfil de
        empleado vinculado a su cuenta. Sin vínculo no ve ninguna cita. La
        cuenta debe pertenecer ya a este negocio.
      </p>
      {error && (
        <div className="bd-alert" role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="bd-success" role="status">
          <CircleCheck size={17} aria-hidden="true" />
          <span>{success}</span>
        </div>
      )}
      {staff === null && !error && <p role="status">Cargando empleados…</p>}
      {staff?.length === 0 && (
        <p className="field-hint">No hay empleados registrados.</p>
      )}
      <ul className="staff-list">
        {staff?.map((member) => (
          <li key={member.id}>
            <div>
              <strong>{member.displayName}</strong>
              {!member.active && (
                <span className="field-hint"> (inactivo)</span>
              )}
              <div className="field-hint">
                {member.user
                  ? `Cuenta vinculada: ${member.user.fullName} · ${member.user.email}`
                  : "Sin cuenta vinculada"}
              </div>
            </div>
            <form
              className="staff-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                const value = (emails[member.id] ?? "").trim();
                if (value) void change(member, value);
              }}
            >
              <label className="visually-hidden" htmlFor={`link-${member.id}`}>
                Correo de la cuenta de {member.displayName}
              </label>
              <input
                id={`link-${member.id}`}
                type="email"
                placeholder="correo@negocio.com"
                value={emails[member.id] ?? ""}
                onChange={(e) =>
                  setEmails({ ...emails, [member.id]: e.target.value })
                }
              />
              <button
                type="submit"
                className="secondary-button"
                disabled={busyId !== null || !(emails[member.id] ?? "").trim()}
              >
                Vincular
              </button>
              {member.user && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busyId !== null}
                  onClick={() => void change(member, null)}
                >
                  Desvincular
                </button>
              )}
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
