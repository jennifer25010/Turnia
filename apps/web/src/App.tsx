import { useEffect, useMemo, useRef, useState } from "react";
import {
  createApiBooking,
  fetchAvailability,
  type AvailabilitySlot,
} from "./booking-api.js";
import type { MembershipRole } from "./auth-api.js";
import BookingDetailDialog from "./BookingDetailDialog";
import { BookingPolicyPanel, StaffLinksPanel } from "./SettingsPanels";
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  ClipboardList,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  X,
  CircleCheck,
  CircleAlert,
} from "lucide-react";

type Page = "Inicio" | "Agenda" | "Citas" | "Personas" | "Configuración";

type Status =
  | "Confirmada"
  | "Pendiente"
  | "Cancelada"
  | "Completada"
  | "No asistió"
  | "Expirada";

type Appointment = {
  id: string | number;
  person: string;
  service: string;
  date: string;
  time: string;
  status: Status;
};

type ApiBooking = {
  id: string;
  status:
    "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | "EXPIRED";
  customerNameSnapshot: string;
  serviceNameSnapshot: string;
  startsAt: string;
  endsAt: string;
};

type ApiBookingsResponse = {
  data: ApiBooking[];
};
type ApiCatalogService = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  staff: { id: string; displayName: string }[];
};
type ApiCatalogResponse = {
  data: { id: string; timezone: string; services: ApiCatalogService[] };
};
const demoServices = ["Orientación inicial", "Seguimiento", "Acompañamiento"];
function isApiCatalogResponse(value: unknown): value is ApiCatalogResponse {
  if (typeof value !== "object" || value === null) return false;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  const catalog = data as {
    id?: unknown;
    timezone?: unknown;
    services?: unknown;
  };
  return (
    typeof catalog.id === "string" &&
    typeof catalog.timezone === "string" &&
    Array.isArray(catalog.services) &&
    catalog.services.every((service: unknown) => {
      if (typeof service !== "object" || service === null) return false;
      const item = service as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.durationMinutes === "number" &&
        typeof item.price === "number" &&
        Array.isArray(item.staff) &&
        item.staff.every(
          (employee: unknown) =>
            typeof employee === "object" &&
            employee !== null &&
            typeof (employee as Record<string, unknown>).id === "string" &&
            typeof (employee as Record<string, unknown>).displayName ===
              "string",
        )
      );
    })
  );
}

type DataSource = "demo" | "api";
const BOGOTA_TIME_ZONE = "America/Bogota";
const apiStatusLabels: Record<ApiBooking["status"], Status> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  COMPLETED: "Completada",
  NO_SHOW: "No asistió",
  EXPIRED: "Expirada",
};
function isApiBooking(value: unknown): value is ApiBooking {
  if (typeof value !== "object" || value === null) return false;
  const booking = value as Record<string, unknown>;
  return (
    typeof booking.id === "string" &&
    typeof booking.customerNameSnapshot === "string" &&
    typeof booking.serviceNameSnapshot === "string" &&
    typeof booking.startsAt === "string" &&
    Number.isFinite(Date.parse(booking.startsAt)) &&
    typeof booking.endsAt === "string" &&
    Number.isFinite(Date.parse(booking.endsAt)) &&
    typeof booking.status === "string" &&
    Object.prototype.hasOwnProperty.call(apiStatusLabels, booking.status)
  );
}
function isApiBookingsResponse(value: unknown): value is ApiBookingsResponse {
  if (typeof value !== "object" || value === null) return false;
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data) && data.every(isApiBooking);
}

function formatBookingDateTime(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: new Intl.DateTimeFormat("es-CO", {
      timeZone: BOGOTA_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date),
  };
}
function mapApiBooking(booking: ApiBooking): Appointment {
  const { date, time } = formatBookingDateTime(booking.startsAt);
  return {
    id: booking.id,
    person: booking.customerNameSnapshot,
    service: booking.serviceNameSnapshot,
    date,
    time,
    status: apiStatusLabels[booking.status],
  };
}
function getTodayInBogota() {
  return formatBookingDateTime(new Date().toISOString()).date;
}
function formatAppointmentMonth(date: string, today: string) {
  const month = new Intl.DateTimeFormat("es-CO", {
    month: "short",
    timeZone: BOGOTA_TIME_ZONE,
  })
    .format(new Date(`${date}T12:00:00-05:00`))
    .replace(".", "")
    .toUpperCase();
  return date === today ? `${month} · HOY` : month;
}

const people = [
  {
    name: "Laura Martínez",
    email: "laura@example.com",
    phone: "300 000 0101",
    type: "Participante",
  },
  {
    name: "Carlos Rodríguez",
    email: "carlos@example.com",
    phone: "300 000 0102",
    type: "Participante",
  },
  {
    name: "Mariana López",
    email: "mariana@example.com",
    phone: "300 000 0103",
    type: "Participante",
  },
  {
    name: "Andrés Gómez",
    email: "andres@example.com",
    phone: "300 000 0104",
    type: "Participante",
  },
  {
    name: "Sofía Torres",
    email: "sofia@example.com",
    phone: "300 000 0105",
    type: "Participante",
  },
];

const navItems: { label: Page; icon: typeof LayoutDashboard }[] = [
  { label: "Inicio", icon: LayoutDashboard },
  { label: "Agenda", icon: CalendarDays },
  { label: "Citas", icon: ClipboardList },
  { label: "Personas", icon: Users },
  { label: "Configuración", icon: Settings },
];

const dateLabel = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: BOGOTA_TIME_ZONE,
}).format(new Date());

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>{status}</span>
  );
}

type AppProps = {
  businessId: string;
  businessName: string;
  role: MembershipRole;
  user: { id: string; email: string; fullName: string };
  onLogout: () => void;
  onSessionExpired: () => void;
};

function initialsOf(fullName: string) {
  const letters = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return letters || "?";
}

export default function App({
  businessId,
  businessName,
  role,
  user,
  onLogout,
  onSessionExpired,
}: AppProps) {
  const [page, setPage] = useState<Page>("Inicio");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [dataSource, setDataSource] = useState<DataSource>("api");
  const [isLoadingBookings, setIsLoadingBookings] = useState(true);
  const [bookingLoadError, setBookingLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [catalog, setCatalog] = useState<ApiCatalogResponse["data"] | null>(
    null,
  );
  const [catalogError, setCatalogError] = useState("");
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [slotsError, setSlotsError] = useState("");
  const [slotsReloadKey, setSlotsReloadKey] = useState(0);
  // Cita abierta en el diálogo de gestión y alcance de reservas del usuario.
  const [managingId, setManagingId] = useState<string | null>(null);
  const [bookingScope, setBookingScope] = useState<{
    kind: string;
    staffId: string | null;
  }>({ kind: "ALL", staffId: null });
  const ownStaffId = bookingScope.kind === "OWN" ? bookingScope.staffId : null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionGuard = useRef(false);
  const [createError, setCreateError] = useState("");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    person: "",
    email: "",
    phone: "",
    notes: "",
    service: "Orientación inicial",
    serviceId: "",
    staffId: "",
    date: getTodayInBogota(),
    time: "09:00",
  });

  useEffect(() => {
    const controller = new AbortController();
    async function loadBookings() {
      setIsLoadingBookings(true);
      setBookingLoadError("");
      try {
        const response = await fetch(
          `/api/v1/bookings?businessId=${encodeURIComponent(businessId)}`,
          { signal: controller.signal },
        );
        if (response.status === 401) {
          onSessionExpired();
          return;
        }
        if (!response.ok)
          throw new Error(`La API respondió con el código ${response.status}.`);
        const payload: unknown = await response.json();
        if (!isApiBookingsResponse(payload))
          throw new Error(
            "La respuesta de citas tiene un formato inesperado o contiene datos inválidos.",
          );
        const bookings = payload.data;
        const meta = (
          payload as { meta?: { scope?: unknown; staffId?: unknown } }
        ).meta;
        setBookingScope({
          kind: typeof meta?.scope === "string" ? meta.scope : "ALL",
          staffId: typeof meta?.staffId === "string" ? meta.staffId : null,
        });
        setAppointments(bookings.map(mapApiBooking));
        setDataSource("api");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setBookingLoadError(
          error instanceof Error
            ? error.message
            : "No fue posible conectar con la API.",
        );
      } finally {
        if (!controller.signal.aborted) setIsLoadingBookings(false);
      }
    }
    void loadBookings();
    return () => controller.abort();
  }, [reloadKey, businessId, onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    async function loadCatalog() {
      setCatalogError("");
      try {
        const response = await fetch(
          `/api/v1/catalog?businessId=${encodeURIComponent(businessId)}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(`La API respondió con el código ${response.status}.`);
        const payload: unknown = await response.json();
        if (!isApiCatalogResponse(payload))
          throw new Error("El catálogo devolvió un formato inesperado.");
        setCatalog(payload.data);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCatalog(null);
        setCatalogError(
          error instanceof Error
            ? error.message
            : "No fue posible cargar los servicios.",
        );
      }
    }
    void loadCatalog();
    return () => controller.abort();
  }, [catalogReloadKey, businessId]);

  useEffect(() => {
    if (!catalog || catalog.services.length === 0) return;
    setForm((current) => {
      const selected =
        catalog.services.find((service) => service.id === current.serviceId) ??
        catalog.services[0];
      if (!selected) return current;
      const offered = ownStaffId
        ? selected.staff.filter((staff) => staff.id === ownStaffId)
        : selected.staff;
      const employee =
        offered.find((staff) => staff.id === current.staffId) ?? offered[0];
      return {
        ...current,
        service: selected.name,
        serviceId: selected.id,
        staffId: employee?.id ?? "",
      };
    });
  }, [catalog, ownStaffId]);
  // Horarios libres calculados por el servidor para el servicio, el empleado
  // y la fecha elegidos en el formulario.
  useEffect(() => {
    if (
      !showModal ||
      dataSource !== "api" ||
      !form.serviceId ||
      !form.staffId ||
      !form.date
    ) {
      setSlots(null);
      setSlotsError("");
      return;
    }
    const controller = new AbortController();
    setSlots(null);
    setSlotsError("");
    fetchAvailability(
      {
        businessId,
        serviceId: form.serviceId,
        staffId: form.staffId,
        date: form.date,
      },
      fetch,
      controller.signal,
    )
      .then((available) => {
        setSlots(available);
        setForm((current) =>
          available.some((slot) => slot.time === current.time)
            ? current
            : { ...current, time: available[0]?.time ?? "" },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSlots([]);
        setSlotsError(
          error instanceof Error
            ? error.message
            : "No fue posible consultar los horarios.",
        );
      });
    return () => controller.abort();
  }, [
    showModal,
    dataSource,
    businessId,
    form.serviceId,
    form.staffId,
    form.date,
    slotsReloadKey,
  ]);
  const filteredAppointments = useMemo(
    () =>
      appointments.filter((item) =>
        `${item.person} ${item.service} ${item.status}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [appointments, search],
  );

  const filteredPeople = useMemo(
    () =>
      people.filter((person) =>
        `${person.name} ${person.email} ${person.phone}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [search],
  );

  const today = dataSource === "api" ? getTodayInBogota() : "2026-10-14";
  const todayAppointments = appointments.filter((item) => item.date === today);
  const confirmed = appointments.filter(
    (item) => item.status === "Confirmada",
  ).length;
  const pending = appointments.filter(
    (item) => item.status === "Pendiente",
  ).length;
  const selectedCatalogService = catalog?.services.find(
    (service) => service.id === form.serviceId,
  );

  async function createAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");
    if (isLoadingBookings || bookingLoadError) {
      setCreateError(
        "No se puede crear la reserva hasta confirmar la conexión y cargar las citas.",
      );
      return;
    }
    if (!form.person.trim()) {
      setCreateError("Escribe el nombre de la persona.");
      return;
    }

    if (dataSource === "demo") {
      setAppointments((current) =>
        [
          ...current,
          {
            id:
              Math.max(
                0,
                ...current
                  .map((item) => item.id)
                  .filter((id): id is number => typeof id === "number"),
              ) + 1,
            person: form.person.trim(),
            service: form.service,
            date: form.date,
            time: form.time,
            status: "Pendiente" as const,
          },
        ].sort((a, b) =>
          `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
        ),
      );
      setShowModal(false);
      setForm({
        person: "",
        email: "",
        phone: "",
        notes: "",
        service: demoServices[0] ?? "Orientación inicial",
        serviceId: "",
        staffId: "",
        date: getTodayInBogota(),
        time: "09:00",
      });
      setNotice(
        "Cita agregada a la demostración. No se ha guardado en la base de datos.",
      );
      return;
    }

    if (submissionGuard.current) return;
    const selectedSlot = slots?.find((slot) => slot.time === form.time);
    const startsAt = selectedSlot?.startsAt ?? null;
    const service = catalog?.services.find(
      (item) => item.id === form.serviceId,
    );
    if (
      !catalog ||
      !service ||
      !service.staff.some((employee) => employee.id === form.staffId)
    ) {
      setCreateError(
        "Selecciona un servicio y un empleado válido para ese servicio.",
      );
      return;
    }
    if (!startsAt) {
      setCreateError(
        "Selecciona uno de los horarios disponibles para esa fecha.",
      );
      return;
    }

    submissionGuard.current = true;
    setIsSubmitting(true);
    try {
      const created = await createApiBooking({
        businessId,
        serviceId: service.id,
        staffId: form.staffId,
        startsAt,
        name: form.person.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      if (!isApiBooking(created)) {
        setReloadKey((key) => key + 1);
        throw new Error(
          "El servidor aceptó la solicitud, pero la respuesta no permite verificar la reserva. Se recargará la lista antes de reintentar.",
        );
      }
      setShowModal(false);
      setForm({
        person: "",
        email: "",
        phone: "",
        notes: "",
        service: service.name,
        serviceId: service.id,
        staffId: form.staffId,
        date: getTodayInBogota(),
        time: "09:00",
      });
      setNotice("Reserva creada y confirmada por la API.");
      setReloadKey((key) => key + 1);
    } catch (error) {
      // El horario pudo ocuparse mientras el formulario estaba abierto.
      setSlotsReloadKey((key) => key + 1);
      setCreateError(
        error instanceof TypeError
          ? "No fue posible conectar con la API. Revisa que el servidor esté iniciado e inténtalo de nuevo."
          : error instanceof Error
            ? error.message
            : "No fue posible crear la reserva. Inténtalo de nuevo.",
      );
    } finally {
      submissionGuard.current = false;
      setIsSubmitting(false);
    }
  }
  function updateStatus(id: string | number, status: Status) {
    if (dataSource === "api" || typeof id === "string") {
      setNotice(
        "Para cambiar el estado de una cita real, ábrela con «Gestionar».",
      );
      return;
    }
    setAppointments((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  }

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="mobile-scrim"
          aria-label="Cerrar menú"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <HeartHandshake size={25} />
          </div>
          <div>
            <strong>turnia</strong>
            <span>GESTIÓN DE CITAS</span>
          </div>
          <button
            className="icon-button mobile-close"
            aria-label="Cerrar menú"
            onClick={() => setMobileNav(false)}
          >
            <X size={19} />
          </button>
        </div>

        <div className="workspace">
          <div className="workspace-avatar">F</div>
          <div className="workspace-copy">
            <strong>Fundación</strong>
            <span>Espacio de trabajo</span>
          </div>
          <ChevronDown size={16} />
        </div>

        <p className="nav-caption">MENÚ PRINCIPAL</p>
        <nav className="main-nav" aria-label="Navegación principal">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${page === label ? "active" : ""}`}
              onClick={() => {
                setPage(label);
                setSearch("");
                setMobileNav(false);
              }}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "Citas" && (
                <span className="nav-count">{appointments.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <Sparkles size={18} />
            </div>
            <strong>Un paso a la vez</strong>
            <p>Organiza las citas y acompaña cada proceso.</p>
          </div>
          <div className="profile">
            <div className="profile-avatar" aria-hidden="true">
              {initialsOf(user.fullName)}
            </div>
            <div className="profile-copy">
              <strong>{user.fullName}</strong>
              <span>{businessName}</span>
            </div>
            <button
              className="icon-button"
              title="Configuración"
              aria-label="Configuración"
              onClick={() => setPage("Configuración")}
            >
              <Settings size={17} />
            </button>
            <button
              className="icon-button"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              onClick={onLogout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Abrir menú"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumbs">
            <span>Turnia</span>
            <span className="crumb-divider">/</span>
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <span className="today-label">
              <CalendarDays size={16} /> {dateLabel}
            </span>
            <button
              className="icon-button notification-button"
              aria-label="Notificaciones"
              onClick={() => setNotice("No tienes notificaciones nuevas.")}
            >
              <Bell size={19} />
              <i />
            </button>
            <div className="top-avatar" aria-hidden="true">
              {initialsOf(user.fullName)}
            </div>
          </div>
        </header>

        <div className="page-content">
          {notice && (
            <div className="notice">
              <CircleAlert size={18} />
              <span>{notice}</span>
              <button onClick={() => setNotice("")} aria-label="Cerrar aviso">
                <X size={17} />
              </button>
            </div>
          )}
          {bookingScope.kind === "UNLINKED" && !isLoadingBookings && (
            <div className="notice" role="status">
              <CircleAlert size={18} />
              <span>
                Tu cuenta todavía no está vinculada a un empleado, por eso no
                ves ninguna cita. Pide a un propietario o administrador que la
                vincule en Configuración.
              </span>
            </div>
          )}
          <div className="notice" role="status">
            <CircleAlert size={18} />
            <span>
              {isLoadingBookings
                ? "Cargando las reservas desde la API…"
                : bookingLoadError
                  ? `No se pudo cargar la API (${bookingLoadError}). No se muestran datos ficticios. Revisa la conexión e inténtalo de nuevo.`
                  : dataSource === "api"
                    ? "Citas reales cargadas desde la API · zona horaria America/Bogota."
                    : "Se muestran datos de demostración."}
            </span>
            {bookingLoadError && (
              <button
                type="button"
                className="text-button"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Reintentar
              </button>
            )}
          </div>

          {page === "Inicio" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">MIÉRCOLES · 14 DE OCTUBRE</span>
                  <h1>
                    ¡Hola! Bienvenido a Turnia <span className="wave">✳</span>
                  </h1>
                  <p>Este es el resumen de lo que está pasando hoy.</p>
                </div>
                <button
                  className="primary-button"
                  disabled={isLoadingBookings}
                  onClick={() => {
                    setCreateError("");
                    setShowModal(true);
                  }}
                >
                  <Plus size={18} /> Nueva cita
                </button>
              </div>

              <section className="welcome-banner">
                <div className="banner-copy">
                  <span className="banner-kicker">
                    <Sparkles size={15} /> TU ESPACIO DE TRABAJO
                  </span>
                  <h2>
                    Más organización,
                    <br />
                    más tiempo para las personas.
                  </h2>
                  <p>Ten tus citas y seguimientos en un solo lugar.</p>
                  <button
                    className="banner-button"
                    onClick={() => setPage("Agenda")}
                  >
                    Explorar agenda <ArrowRight size={16} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="art-sun" />
                  <div className="art-calendar">
                    <CalendarDays size={43} />
                    <span>14</span>
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="art-sparkle sparkle-one">✳</div>
                  <div className="art-sparkle sparkle-two">✦</div>
                  <div className="art-orbit" />
                </div>
              </section>

              <section className="metrics-grid" aria-label="Indicadores">
                <article className="metric-card">
                  <div className="metric-top">
                    <span>Citas de hoy</span>
                    <div className="metric-icon coral">
                      <CalendarDays size={19} />
                    </div>
                  </div>
                  <div className="metric-number">
                    {todayAppointments.length.toString().padStart(2, "0")}
                  </div>
                  <div className="metric-foot">
                    <span className="metric-neutral">
                      <Activity size={14} /> En agenda
                    </span>
                    <span>Hoy</span>
                  </div>
                </article>
                <article className="metric-card">
                  <div className="metric-top">
                    <span>Confirmadas</span>
                    <div className="metric-icon green">
                      <CircleCheck size={19} />
                    </div>
                  </div>
                  <div className="metric-number">
                    {confirmed.toString().padStart(2, "0")}
                  </div>
                  <div className="metric-foot">
                    <span className="metric-green">
                      <Check size={14} /> Confirmación lista
                    </span>
                  </div>
                </article>
                <article className="metric-card">
                  <div className="metric-top">
                    <span>Pendientes</span>
                    <div className="metric-icon orange">
                      <Clock3 size={19} />
                    </div>
                  </div>
                  <div className="metric-number">
                    {pending.toString().padStart(2, "0")}
                  </div>
                  <div className="metric-foot">
                    <span className="metric-orange">
                      <Clock3 size={14} /> Por confirmar
                    </span>
                  </div>
                </article>
                <article className="metric-card">
                  <div className="metric-top">
                    <span>Personas</span>
                    <div className="metric-icon purple">
                      <Users size={19} />
                    </div>
                  </div>
                  <div className="metric-number">
                    {people.length.toString().padStart(2, "0")}
                  </div>
                  <div className="metric-foot">
                    <span className="metric-neutral">
                      Directorio de ejemplo
                    </span>
                  </div>
                </article>
              </section>

              <div className="dashboard-grid">
                <section className="panel appointments-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Próximas citas</h3>
                      <p>Una mirada rápida a tu agenda.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("Citas")}
                    >
                      Ver todas <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="appointment-list">
                    {appointments
                      .filter((item) => item.date >= today)
                      .slice(0, 4)
                      .map((item) => (
                        <div className="appointment-row" key={item.id}>
                          <div className="appointment-date">
                            <strong>{item.date.slice(8, 10)}</strong>
                            <span>
                              {formatAppointmentMonth(item.date, today)}
                            </span>
                          </div>
                          <div className="appointment-info">
                            <strong>{item.person}</strong>
                            <span>{item.service}</span>
                          </div>
                          <div className="appointment-time">
                            <Clock3 size={14} />
                            {item.time}
                          </div>
                          <StatusBadge status={item.status} />
                        </div>
                      ))}
                  </div>
                  <button
                    className="panel-footer-link"
                    onClick={() => setPage("Agenda")}
                  >
                    Abrir agenda completa <ArrowRight size={16} />
                  </button>
                </section>
                <section className="panel agenda-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Tu semana</h3>
                      <p>Del 12 al 18 de octubre</p>
                    </div>
                    <button
                      className="round-arrow"
                      aria-label="Ir a agenda"
                      onClick={() => setPage("Agenda")}
                    >
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <div className="week-strip">
                    {["L", "M", "X", "J", "V", "S", "D"].map((day, i) => (
                      <button
                        key={day}
                        className={`week-day ${i === 2 ? "selected" : ""}`}
                        onClick={() => setPage("Agenda")}
                      >
                        <span>{day}</span>
                        <strong>{12 + i}</strong>
                        <i className={i === 2 ? "dot-current" : ""} />
                      </button>
                    ))}
                  </div>
                  <div className="agenda-summary">
                    <div className="summary-symbol">
                      <CalendarDays size={19} />
                    </div>
                    <div>
                      <strong>
                        {todayAppointments.length} citas programadas
                      </strong>
                      <span>Para el día de hoy</span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Ver agenda"
                      onClick={() => setPage("Agenda")}
                    >
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <div className="mini-note">
                    <span className="mini-note-dot" />{" "}
                    {dataSource === "api"
                      ? "Las reservas nuevas se guardan en PostgreSQL."
                      : "Los cambios de esta sesión son demostrativos."}
                  </div>
                </section>
              </div>
            </>
          )}

          {page === "Agenda" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">PLANIFICACIÓN</span>
                  <h1>Agenda</h1>
                  <p>Consulta las citas programadas y organiza tu semana.</p>
                </div>
                <button
                  className="primary-button"
                  disabled={isLoadingBookings}
                  onClick={() => {
                    setCreateError("");
                    setShowModal(true);
                  }}
                >
                  <Plus size={18} /> Nueva cita
                </button>
              </div>
              <section className="panel section-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Semana del 12 al 18 de octubre</h3>
                    <p>
                      {dataSource === "api"
                        ? "Calendario semanal de demostración"
                        : "Agenda demostrativa · 2026"}
                    </p>
                  </div>
                  <span className="demo-tag">Calendario de demostración</span>
                </div>
                <div className="calendar-week">
                  {[
                    "Lun|12",
                    "Mar|13",
                    "Mié|14",
                    "Jue|15",
                    "Vie|16",
                    "Sáb|17",
                    "Dom|18",
                  ].map((day, i) => (
                    <div
                      className={`calendar-day ${i === 2 ? "calendar-today" : ""}`}
                      key={day}
                    >
                      <span>{day.split("|")[0]}</span>
                      <strong>{day.split("|")[1]}</strong>
                      {appointments
                        .filter(
                          (a) =>
                            dataSource === "demo" &&
                            a.date === `2026-10-${day.split("|")[1]}`,
                        )
                        .map((a) => (
                          <div className="calendar-event" key={a.id}>
                            <b>{a.time}</b>
                            <span>{a.person}</span>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel section-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Próximas citas</h3>
                    <p>Ordenadas por fecha y hora.</p>
                  </div>
                </div>
                <AppointmentTable
                  items={filteredAppointments}
                  onStatus={updateStatus}
                  onManage={dataSource === "api" ? setManagingId : undefined}
                  readOnly={dataSource === "api"}
                />
              </section>
            </>
          )}

          {page === "Citas" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">SEGUIMIENTO</span>
                  <h1>Citas</h1>
                  <p>
                    {dataSource === "api"
                      ? "Consulta las citas del negocio."
                      : "Consulta y administra las citas de ejemplo."}
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={isLoadingBookings}
                  onClick={() => {
                    setCreateError("");
                    setShowModal(true);
                  }}
                >
                  <Plus size={18} /> Nueva cita
                </button>
              </div>
              <section className="panel section-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Todas las citas</h3>
                    <p>
                      {appointments.length}{" "}
                      {dataSource === "api"
                        ? "citas del negocio."
                        : "registros en esta demostración."}
                    </p>
                  </div>
                  <span className="demo-tag">
                    {dataSource === "api" ? "Datos reales" : "Datos de prueba"}
                  </span>
                </div>
                <div className="table-toolbar">
                  <label className="search-box">
                    <Search size={17} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar por persona, servicio o estado..."
                    />
                  </label>
                  <span className="result-count">
                    {filteredAppointments.length} resultados
                  </span>
                </div>
                <AppointmentTable
                  items={filteredAppointments}
                  onStatus={updateStatus}
                  onManage={dataSource === "api" ? setManagingId : undefined}
                  readOnly={dataSource === "api"}
                />
              </section>
            </>
          )}

          {page === "Personas" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">DIRECTORIO</span>
                  <h1>Personas</h1>
                  <p>Consulta el directorio de participantes de ejemplo.</p>
                </div>
                <div className="people-total">
                  <Users size={18} /> {people.length} personas
                </div>
              </div>
              <section className="panel section-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Directorio de personas</h3>
                    <p>Información ficticia para probar la interfaz.</p>
                  </div>
                  <span className="demo-tag">Datos de prueba</span>
                </div>
                <div className="table-toolbar">
                  <label className="search-box">
                    <Search size={17} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar por nombre, correo o teléfono..."
                    />
                  </label>
                  <span className="result-count">
                    {filteredPeople.length} resultados
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>PERSONA</th>
                        <th>CONTACTO</th>
                        <th>TIPO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPeople.map((person) => (
                        <tr key={person.email}>
                          <td>
                            <div className="person-cell">
                              <div className="person-avatar">
                                {person.name
                                  .split(" ")
                                  .map((part) => part[0])
                                  .slice(0, 2)
                                  .join("")}
                              </div>
                              <strong>{person.name}</strong>
                            </div>
                          </td>
                          <td>
                            <div className="contact-cell">
                              <span>{person.email}</span>
                              <span>{person.phone}</span>
                            </div>
                          </td>
                          <td>
                            <span className="person-type">{person.type}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredPeople.length === 0 && (
                    <div className="empty-state">
                      No encontramos personas con esa búsqueda.
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {page === "Configuración" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">PERSONALIZACIÓN</span>
                  <h1>Configuración</h1>
                  <p>
                    Reglas de reserva, cuentas del equipo y estado de esta
                    versión.
                  </p>
                </div>
              </div>
              {(role === "OWNER" || role === "ADMIN") && (
                <>
                  <BookingPolicyPanel
                    businessId={businessId}
                    onSessionExpired={onSessionExpired}
                  />
                  <StaffLinksPanel
                    businessId={businessId}
                    onSessionExpired={onSessionExpired}
                  />
                </>
              )}
              <section className="panel settings-panel">
                <div className="settings-intro">
                  <div className="settings-big-icon">
                    <Settings size={25} />
                  </div>
                  <div>
                    <h3>Identidad visual de Turnia</h3>
                    <p>
                      Una paleta cálida, accesible y coherente con la
                      experiencia de la fundación.
                    </p>
                  </div>
                </div>
                <div className="palette-grid">
                  {[
                    ["#FFE8D6", "Crema"],
                    ["#FFB79A", "Salmón suave"],
                    ["#FF8360", "Coral"],
                    ["#E8543F", "Terracota"],
                    ["#9C2B1B", "Rojo profundo"],
                  ].map(([hex, name]) => (
                    <div className="palette-item" key={hex}>
                      <div
                        className="color-swatch"
                        style={{ backgroundColor: hex }}
                      />
                      <strong>{name}</strong>
                      <code>{hex}</code>
                    </div>
                  ))}
                </div>
                <div className="settings-divider" />
                <div className="settings-row">
                  <div>
                    <strong>Versión de la interfaz</strong>
                    <p>Panel inicial navegable</p>
                  </div>
                  <span className="settings-value">0.2.0 · Demo</span>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>Persistencia de datos</strong>
                    <p>
                      {dataSource === "api"
                        ? "Las citas, sus cambios y su historial se guardan en PostgreSQL; la sección Personas sigue en demostración."
                        : "Las citas visibles son datos de demostración hasta conectar la API."}
                    </p>
                  </div>
                  <span className="status status-pendiente">
                    {dataSource === "api" ? "Citas conectadas" : "Demo"}
                  </span>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>API y base de datos</strong>
                    <p>
                      {dataSource === "api"
                        ? "La API respondió correctamente y entregó las citas del negocio."
                        : "Sin conexión a la API; se muestran datos de demostración."}
                    </p>
                  </div>
                  <span className="settings-value">
                    <CircleAlert size={15} />
                    {dataSource === "api" ? " Conectada" : " Demo"}
                  </span>
                </div>
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>
              Turnia <span>·</span> Gestión de citas
            </span>
            <span>Versión de demostración</span>
          </footer>
        </div>
      </main>

      {showModal && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSubmitting)
              setShowModal(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">NUEVO REGISTRO</span>
                <h2 id="modal-title">Crear una cita</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Cerrar"
                disabled={isSubmitting}
                onClick={() => setShowModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="modal-description">
              {dataSource === "api"
                ? "Completa los datos para crear una reserva real."
                : "Completa los datos para agregar una cita de demostración."}
            </p>
            {dataSource === "api" && catalogError && (
              <div className="notice" role="alert">
                <CircleAlert size={17} />
                <span>No se pudo cargar el catálogo: {catalogError}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCatalogReloadKey((key) => key + 1)}
                >
                  Reintentar
                </button>
              </div>
            )}
            {createError && (
              <div className="notice" role="alert">
                <CircleAlert size={17} />
                <span>{createError}</span>
                <button
                  type="button"
                  aria-label="Cerrar error"
                  onClick={() => setCreateError("")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <form onSubmit={createAppointment}>
              <label>
                Nombre de la persona
                <input
                  required
                  maxLength={150}
                  value={form.person}
                  onChange={(e) => setForm({ ...form, person: e.target.value })}
                  placeholder="Ej. Daniela Pérez"
                />
              </label>
              <div className="form-row">
                <label>
                  Correo electrónico (opcional)
                  <input
                    type="email"
                    maxLength={254}
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    placeholder="persona@ejemplo.com"
                  />
                </label>
                <label>
                  Teléfono (opcional)
                  <input
                    type="tel"
                    maxLength={40}
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                    placeholder="300 123 4567"
                  />
                </label>
              </div>
              <label>
                Servicio
                <select
                  required
                  value={dataSource === "api" ? form.serviceId : form.service}
                  disabled={
                    dataSource === "api" &&
                    (!catalog || catalog.services.length === 0)
                  }
                  onChange={(e) => {
                    if (dataSource === "api") {
                      const service = catalog?.services.find(
                        (item) => item.id === e.target.value,
                      );
                      setForm({
                        ...form,
                        service: service?.name ?? "",
                        serviceId: service?.id ?? "",
                        staffId: service?.staff[0]?.id ?? "",
                      });
                    } else setForm({ ...form, service: e.target.value });
                  }}
                >
                  {dataSource === "api" ? (
                    <>
                      {!catalog && (
                        <option value="">Cargando servicios…</option>
                      )}
                      {catalog?.services.length === 0 && (
                        <option value="">No hay servicios disponibles</option>
                      )}
                      {catalog?.services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} · {service.durationMinutes} min
                        </option>
                      ))}
                    </>
                  ) : (
                    demoServices.map((service) => (
                      <option key={service}>{service}</option>
                    ))
                  )}
                </select>
              </label>
              {dataSource === "api" && (
                <label>
                  Empleado
                  <select
                    required
                    value={form.staffId}
                    disabled={
                      !selectedCatalogService ||
                      selectedCatalogService.staff.length === 0
                    }
                    onChange={(e) =>
                      setForm({ ...form, staffId: e.target.value })
                    }
                  >
                    <option value="">
                      {selectedCatalogService?.staff.length
                        ? "Selecciona un empleado"
                        : "No hay empleados para este servicio"}
                    </option>
                    {selectedCatalogService?.staff
                      .filter(
                        (employee) => !ownStaffId || employee.id === ownStaffId,
                      )
                      .map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.displayName}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <div className="form-row">
                <label>
                  Fecha
                  <input
                    required
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </label>
                {dataSource === "api" ? (
                  <label>
                    Hora disponible
                    <select
                      required
                      value={form.time}
                      disabled={!slots || slots.length === 0}
                      onChange={(e) =>
                        setForm({ ...form, time: e.target.value })
                      }
                    >
                      {slots === null && !slotsError && (
                        <option value="">Consultando horarios…</option>
                      )}
                      {slots?.length === 0 && (
                        <option value="">Sin horarios disponibles</option>
                      )}
                      {slots?.map((slot) => (
                        <option key={slot.startsAt} value={slot.time}>
                          {slot.time}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    Hora (Bogotá)
                    <input
                      required
                      type="time"
                      value={form.time}
                      onChange={(e) =>
                        setForm({ ...form, time: e.target.value })
                      }
                    />
                  </label>
                )}
              </div>
              {dataSource === "api" && slotsError && (
                <div className="notice" role="alert">
                  <CircleAlert size={17} />
                  <span>{slotsError}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSlotsReloadKey((key) => key + 1)}
                  >
                    Reintentar
                  </button>
                </div>
              )}
              {dataSource === "api" && slots?.length === 0 && !slotsError && (
                <p className="field-hint" role="status">
                  No hay horarios libres para esa fecha. Prueba con otro día u
                  otro empleado.
                </p>
              )}
              {dataSource === "api" && (
                <label>
                  Notas (opcional)
                  <textarea
                    maxLength={2000}
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                    rows={3}
                  />
                </label>
              )}
              <div className="modal-warning">
                <CircleAlert size={17} />
                <span>
                  {dataSource === "api"
                    ? "La duración se toma del servicio. Solo se ofrecen horarios libres según la agenda del negocio y del empleado."
                    : "Esta cita solo se guarda en el estado temporal de la página, no en PostgreSQL."}
                </span>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isSubmitting}
                  onClick={() => setShowModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    isSubmitting ||
                    (dataSource === "api" &&
                      (isLoadingBookings ||
                        !slots ||
                        slots.length === 0 ||
                        !form.time ||
                        !catalog ||
                        !selectedCatalogService ||
                        selectedCatalogService.staff.length === 0))
                  }
                >
                  <Plus size={17} />{" "}
                  {isSubmitting
                    ? "Guardando…"
                    : dataSource === "api"
                      ? "Guardar reserva"
                      : "Crear cita"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {managingId && (
        <BookingDetailDialog
          key={managingId}
          bookingId={managingId}
          businessId={businessId}
          services={catalog?.services ?? []}
          onClose={() => setManagingId(null)}
          onChanged={() => setReloadKey((key) => key + 1)}
          onSessionExpired={onSessionExpired}
        />
      )}
    </div>
  );
}

function AppointmentTable({
  items,
  onStatus,
  onManage,
  readOnly = false,
}: {
  items: Appointment[];
  onStatus: (id: string | number, status: Status) => void;
  /** Con citas reales: abre el diálogo de gestión (estado, cancelar, modificar). */
  onManage?: (id: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>PERSONA</th>
            <th>SERVICIO</th>
            <th>FECHA Y HORA</th>
            <th>ESTADO</th>
            {onManage && (
              <th>
                <span className="visually-hidden">ACCIONES</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <div className="person-cell">
                  <div className="person-avatar">
                    {item.person
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <strong>{item.person}</strong>
                </div>
              </td>
              <td>{item.service}</td>
              <td>
                <div className="contact-cell">
                  <span>{item.date}</span>
                  <span>{item.time}</span>
                </div>
              </td>
              <td>
                {onManage ? (
                  <span
                    className={`status status-${item.status
                      .toLowerCase()
                      .normalize("NFD")
                      .replace(/[\u0300-\u036f]/g, "")
                      .replace(/\s+/g, "-")}`}
                  >
                    {item.status}
                  </span>
                ) : (
                  <select
                    disabled={readOnly}
                    className={`status-select status-${item.status.toLowerCase()}`}
                    aria-label={`Estado de ${item.person}`}
                    value={item.status}
                    onChange={(e) =>
                      onStatus(item.id, e.target.value as Status)
                    }
                  >
                    <option>Confirmada</option>
                    <option>Pendiente</option>
                    <option>Cancelada</option>
                    <option>Completada</option>
                    <option>No asistió</option>
                    <option>Expirada</option>
                  </select>
                )}
              </td>
              {onManage && (
                <td>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onManage(String(item.id))}
                    aria-label={`Gestionar la cita de ${item.person}`}
                  >
                    Gestionar
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <div className="empty-state">
          No encontramos citas con esa búsqueda.
        </div>
      )}
    </div>
  );
}
