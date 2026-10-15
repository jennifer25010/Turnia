import { useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowRight, Bell, CalendarDays,
  Check, ChevronDown, Clock3, ClipboardList, HeartHandshake,
  LayoutDashboard, Menu, Plus, Search, Settings, Sparkles,
  Users, X, CircleCheck, CircleAlert
} from "lucide-react";

type Page = "Inicio" | "Agenda" | "Citas" | "Personas" | "Configuración";
type Status = "Confirmada" | "Pendiente" | "Cancelada";

type Appointment = {
  id: number;
  person: string;
  service: string;
  date: string;
  time: string;
  status: Status;
};

const initialAppointments: Appointment[] = [
  { id: 1, person: "Laura Martínez", service: "Orientación inicial", date: "2026-10-14", time: "09:00", status: "Confirmada" },
  { id: 2, person: "Carlos Rodríguez", service: "Seguimiento", date: "2026-10-14", time: "10:30", status: "Pendiente" },
  { id: 3, person: "Mariana López", service: "Acompañamiento", date: "2026-10-14", time: "11:30", status: "Confirmada" },
  { id: 4, person: "Andrés Gómez", service: "Orientación inicial", date: "2026-10-15", time: "08:30", status: "Pendiente" },
  { id: 5, person: "Sofía Torres", service: "Seguimiento", date: "2026-10-15", time: "14:00", status: "Confirmada" },
];

const people = [
  { name: "Laura Martínez", email: "laura@example.com", phone: "300 000 0101", type: "Participante" },
  { name: "Carlos Rodríguez", email: "carlos@example.com", phone: "300 000 0102", type: "Participante" },
  { name: "Mariana López", email: "mariana@example.com", phone: "300 000 0103", type: "Participante" },
  { name: "Andrés Gómez", email: "andres@example.com", phone: "300 000 0104", type: "Participante" },
  { name: "Sofía Torres", email: "sofia@example.com", phone: "300 000 0105", type: "Participante" },
];

const navItems: { label: Page; icon: typeof LayoutDashboard }[] = [
  { label: "Inicio", icon: LayoutDashboard },
  { label: "Agenda", icon: CalendarDays },
  { label: "Citas", icon: ClipboardList },
  { label: "Personas", icon: Users },
  { label: "Configuración", icon: Settings },
];

const dateLabel = new Intl.DateTimeFormat("es-CO", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
  timeZone: "UTC",
}).format(new Date("2026-10-14T12:00:00Z"));

function StatusBadge({ status }: { status: Status }) {
  return <span className={`status status-${status.toLowerCase()}`}>{status}</span>;
}

export default function App() {
  const [page, setPage] = useState<Page>("Inicio");
  const [appointments, setAppointments] = useState(initialAppointments);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    person: "", service: "Orientación inicial", date: "2026-10-16", time: "09:00",
  });

  const filteredAppointments = useMemo(() => appointments.filter((item) =>
    `${item.person} ${item.service} ${item.status}`.toLowerCase().includes(search.toLowerCase())
  ), [appointments, search]);

  const filteredPeople = useMemo(() => people.filter((person) =>
    `${person.name} ${person.email} ${person.phone}`.toLowerCase().includes(search.toLowerCase())
  ), [search]);

  const todayAppointments = appointments.filter((item) => item.date === "2026-10-14");
  const confirmed = appointments.filter((item) => item.status === "Confirmada").length;
  const pending = appointments.filter((item) => item.status === "Pendiente").length;

  function createAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.person.trim()) return;
    setAppointments((current) => [...current, {
      id: Math.max(0, ...current.map((item) => item.id)) + 1,
      ...form,
      person: form.person.trim(),
      status: "Pendiente" as Status,
    }].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)));
    setShowModal(false);
    setForm({ person: "", service: "Orientación inicial", date: "2026-10-16", time: "09:00" });
    setNotice("Cita agregada a la demostración. No se ha guardado en la base de datos.");
  }

  function updateStatus(id: number, status: Status) {
    setAppointments((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  }

  return (
    <div className="app-shell">
      {mobileNav && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><HeartHandshake size={25} /></div>
          <div><strong>turnia</strong><span>GESTIÓN DE CITAS</span></div>
          <button className="icon-button mobile-close" aria-label="Cerrar menú" onClick={() => setMobileNav(false)}><X size={19} /></button>
        </div>

        <div className="workspace">
          <div className="workspace-avatar">F</div>
          <div className="workspace-copy"><strong>Fundación</strong><span>Espacio de trabajo</span></div>
          <ChevronDown size={16} />
        </div>

        <p className="nav-caption">MENÚ PRINCIPAL</p>
        <nav className="main-nav" aria-label="Navegación principal">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${page === label ? "active" : ""}`}
              onClick={() => { setPage(label); setSearch(""); setMobileNav(false); }}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
              {label === "Citas" && <span className="nav-count">{appointments.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon"><Sparkles size={18} /></div>
            <strong>Un paso a la vez</strong>
            <p>Organiza las citas y acompaña cada proceso.</p>
          </div>
          <div className="profile">
            <div className="profile-avatar">AD</div>
            <div className="profile-copy"><strong>Administrador</strong><span>Equipo Turnia</span></div>
            <button className="icon-button" title="Configuración" onClick={() => setPage("Configuración")}><Settings size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Abrir menú" onClick={() => setMobileNav(true)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>Turnia</span><span className="crumb-divider">/</span><strong>{page}</strong></div>
          <div className="topbar-actions">
            <span className="today-label"><CalendarDays size={16} /> {dateLabel}</span>
            <button className="icon-button notification-button" aria-label="Notificaciones" onClick={() => setNotice("No tienes notificaciones nuevas.")}><Bell size={19} /><i /></button>
            <div className="top-avatar">AD</div>
          </div>
        </header>

        <div className="page-content">
          {notice && <div className="notice"><CircleAlert size={18} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Cerrar aviso"><X size={17} /></button></div>}

          {page === "Inicio" && <>
            <div className="page-heading">
              <div><span className="eyebrow">MIÉRCOLES · 14 DE OCTUBRE</span><h1>¡Hola! Bienvenido a Turnia <span className="wave">✳</span></h1><p>Este es el resumen de lo que está pasando hoy.</p></div>
              <button className="primary-button" onClick={() => setShowModal(true)}><Plus size={18} /> Nueva cita</button>
            </div>

            <section className="welcome-banner">
              <div className="banner-copy"><span className="banner-kicker"><Sparkles size={15} /> TU ESPACIO DE TRABAJO</span><h2>Más organización,<br />más tiempo para las personas.</h2><p>Ten tus citas y seguimientos en un solo lugar.</p><button className="banner-button" onClick={() => setPage("Agenda")}>Explorar agenda <ArrowRight size={16} /></button></div>
              <div className="banner-art" aria-hidden="true"><div className="art-sun" /><div className="art-calendar"><CalendarDays size={43} /><span>14</span><i /><i /><i /><i /><i /><i /></div><div className="art-sparkle sparkle-one">✳</div><div className="art-sparkle sparkle-two">✦</div><div className="art-orbit" /></div>
            </section>

            <section className="metrics-grid" aria-label="Indicadores">
              <article className="metric-card"><div className="metric-top"><span>Citas de hoy</span><div className="metric-icon coral"><CalendarDays size={19} /></div></div><div className="metric-number">{todayAppointments.length.toString().padStart(2, "0")}</div><div className="metric-foot"><span className="metric-neutral"><Activity size={14} /> En agenda</span><span>Hoy</span></div></article>
              <article className="metric-card"><div className="metric-top"><span>Confirmadas</span><div className="metric-icon green"><CircleCheck size={19} /></div></div><div className="metric-number">{confirmed.toString().padStart(2, "0")}</div><div className="metric-foot"><span className="metric-green"><Check size={14} /> Confirmación lista</span></div></article>
              <article className="metric-card"><div className="metric-top"><span>Pendientes</span><div className="metric-icon orange"><Clock3 size={19} /></div></div><div className="metric-number">{pending.toString().padStart(2, "0")}</div><div className="metric-foot"><span className="metric-orange"><Clock3 size={14} /> Por confirmar</span></div></article>
              <article className="metric-card"><div className="metric-top"><span>Personas</span><div className="metric-icon purple"><Users size={19} /></div></div><div className="metric-number">{people.length.toString().padStart(2, "0")}</div><div className="metric-foot"><span className="metric-neutral">Directorio de ejemplo</span></div></article>
            </section>

            <div className="dashboard-grid">
              <section className="panel appointments-panel">
                <div className="panel-heading"><div><h3>Próximas citas</h3><p>Una mirada rápida a tu agenda.</p></div><button className="text-button" onClick={() => setPage("Citas")}>Ver todas <ArrowRight size={15} /></button></div>
                <div className="appointment-list">
                  {appointments.filter((item) => item.date >= "2026-10-14").slice(0, 4).map((item) => <div className="appointment-row" key={item.id}><div className="appointment-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date === "2026-10-14" ? "OCT · HOY" : "OCT"}</span></div><div className="appointment-info"><strong>{item.person}</strong><span>{item.service}</span></div><div className="appointment-time"><Clock3 size={14} />{item.time}</div><StatusBadge status={item.status} /></div>)}
                </div>
                <button className="panel-footer-link" onClick={() => setPage("Agenda")}>Abrir agenda completa <ArrowRight size={16} /></button>
              </section>
              <section className="panel agenda-panel">
                <div className="panel-heading"><div><h3>Tu semana</h3><p>Del 12 al 18 de octubre</p></div><button className="round-arrow" aria-label="Ir a agenda" onClick={() => setPage("Agenda")}><ArrowRight size={17} /></button></div>
                <div className="week-strip">{["L","M","X","J","V","S","D"].map((day, i) => <button key={day} className={`week-day ${i === 2 ? "selected" : ""}`} onClick={() => setPage("Agenda")}><span>{day}</span><strong>{12 + i}</strong><i className={i === 2 ? "dot-current" : ""} /></button>)}</div>
                <div className="agenda-summary"><div className="summary-symbol"><CalendarDays size={19} /></div><div><strong>{todayAppointments.length} citas programadas</strong><span>Para el día de hoy</span></div><button className="icon-button" aria-label="Ver agenda" onClick={() => setPage("Agenda")}><ArrowRight size={17} /></button></div>
                <div className="mini-note"><span className="mini-note-dot" /> Los cambios de esta sesión son demostrativos.</div>
              </section>
            </div>
          </>}

          {page === "Agenda" && <>
            <div className="page-heading"><div><span className="eyebrow">PLANIFICACIÓN</span><h1>Agenda</h1><p>Consulta las citas programadas y organiza tu semana.</p></div><button className="primary-button" onClick={() => setShowModal(true)}><Plus size={18} /> Nueva cita</button></div>
            <section className="panel section-panel"><div className="panel-heading"><div><h3>Semana del 12 al 18 de octubre</h3><p>Agenda demostrativa · 2026</p></div><span className="demo-tag">Datos de prueba</span></div><div className="calendar-week">{["Lun|12","Mar|13","Mié|14","Jue|15","Vie|16","Sáb|17","Dom|18"].map((day, i) => <div className={`calendar-day ${i === 2 ? "calendar-today" : ""}`} key={day}><span>{day.split("|")[0]}</span><strong>{day.split("|")[1]}</strong>{appointments.filter((a) => a.date === `2026-10-${day.split("|")[1]}`).map((a) => <div className="calendar-event" key={a.id}><b>{a.time}</b><span>{a.person}</span></div>)}</div>)}</div></section>
            <section className="panel section-panel"><div className="panel-heading"><div><h3>Próximas citas</h3><p>Ordenadas por fecha y hora.</p></div></div><AppointmentTable items={filteredAppointments} onStatus={updateStatus} /></section>
          </>}

          {page === "Citas" && <>
            <div className="page-heading"><div><span className="eyebrow">SEGUIMIENTO</span><h1>Citas</h1><p>Consulta y administra las citas de ejemplo.</p></div><button className="primary-button" onClick={() => setShowModal(true)}><Plus size={18} /> Nueva cita</button></div>
            <section className="panel section-panel"><div className="panel-heading"><div><h3>Todas las citas</h3><p>{appointments.length} registros en esta demostración.</p></div><span className="demo-tag">Datos de prueba</span></div><div className="table-toolbar"><label className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por persona, servicio o estado..." /></label><span className="result-count">{filteredAppointments.length} resultados</span></div><AppointmentTable items={filteredAppointments} onStatus={updateStatus} /></section>
          </>}

          {page === "Personas" && <>
            <div className="page-heading"><div><span className="eyebrow">DIRECTORIO</span><h1>Personas</h1><p>Consulta el directorio de participantes de ejemplo.</p></div><div className="people-total"><Users size={18} /> {people.length} personas</div></div>
            <section className="panel section-panel"><div className="panel-heading"><div><h3>Directorio de personas</h3><p>Información ficticia para probar la interfaz.</p></div><span className="demo-tag">Datos de prueba</span></div><div className="table-toolbar"><label className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, correo o teléfono..." /></label><span className="result-count">{filteredPeople.length} resultados</span></div><div className="table-wrap"><table><thead><tr><th>PERSONA</th><th>CONTACTO</th><th>TIPO</th></tr></thead><tbody>{filteredPeople.map((person) => <tr key={person.email}><td><div className="person-cell"><div className="person-avatar">{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div><strong>{person.name}</strong></div></td><td><div className="contact-cell"><span>{person.email}</span><span>{person.phone}</span></div></td><td><span className="person-type">{person.type}</span></td></tr>)}</tbody></table>{filteredPeople.length === 0 && <div className="empty-state">No encontramos personas con esa búsqueda.</div>}</div></section>
          </>}

          {page === "Configuración" && <>
            <div className="page-heading"><div><span className="eyebrow">PERSONALIZACIÓN</span><h1>Configuración</h1><p>Conoce la identidad visual y el estado de esta versión.</p></div></div>
            <section className="panel settings-panel"><div className="settings-intro"><div className="settings-big-icon"><Settings size={25} /></div><div><h3>Identidad visual de Turnia</h3><p>Una paleta cálida, accesible y coherente con la experiencia de la fundación.</p></div></div><div className="palette-grid">{[["#FFE8D6","Crema"],["#FFB79A","Salmón suave"],["#FF8360","Coral"],["#E8543F","Terracota"],["#9C2B1B","Rojo profundo"]].map(([hex, name]) => <div className="palette-item" key={hex}><div className="color-swatch" style={{ backgroundColor: hex }} /><strong>{name}</strong><code>{hex}</code></div>)}</div><div className="settings-divider" /><div className="settings-row"><div><strong>Versión de la interfaz</strong><p>Panel inicial navegable</p></div><span className="settings-value">0.2.0 · Demo</span></div><div className="settings-row"><div><strong>Persistencia de datos</strong><p>Los cambios se pierden al recargar la página.</p></div><span className="status status-pendiente">No conectada</span></div><div className="settings-row"><div><strong>API y base de datos</strong><p>La conexión debe integrarse y probarse antes de usar datos reales.</p></div><span className="settings-value"><CircleAlert size={15} /> Pendiente</span></div></section>
          </>}
          <footer className="page-footer"><span>Turnia <span>·</span> Gestión de citas</span><span>Versión de demostración</span></footer>
        </div>
      </main>

      {showModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowModal(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><span className="eyebrow">NUEVO REGISTRO</span><h2 id="modal-title">Crear una cita</h2></div><button className="icon-button" aria-label="Cerrar" onClick={() => setShowModal(false)}><X size={20} /></button></div><p className="modal-description">Completa los datos para agregar una cita de prueba.</p><form onSubmit={createAppointment}><label>Nombre de la persona<input required value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} placeholder="Ej. Daniela Pérez" /></label><label>Servicio<select value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}><option>Orientación inicial</option><option>Seguimiento</option><option>Acompañamiento</option></select></label><div className="form-row"><label>Fecha<input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>Hora<input required type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label></div><div className="modal-warning"><CircleAlert size={17} /><span>Esta cita solo se guarda en el estado temporal de la página, no en PostgreSQL.</span></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowModal(false)}>Cancelar</button><button type="submit" className="primary-button"><Plus size={17} /> Crear cita</button></div></form></section></div>}
    </div>
  );
}

function AppointmentTable({ items, onStatus }: { items: Appointment[]; onStatus: (id: number, status: Status) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>PERSONA</th><th>SERVICIO</th><th>FECHA Y HORA</th><th>ESTADO</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><div className="person-cell"><div className="person-avatar">{item.person.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div><strong>{item.person}</strong></div></td><td>{item.service}</td><td><div className="contact-cell"><span>{item.date}</span><span>{item.time}</span></div></td><td><select className={`status-select status-${item.status.toLowerCase()}`} aria-label={`Estado de ${item.person}`} value={item.status} onChange={(e) => onStatus(item.id, e.target.value as Status)}><option>Confirmada</option><option>Pendiente</option><option>Cancelada</option></select></td></tr>)}</tbody></table>{items.length === 0 && <div className="empty-state">No encontramos citas con esa búsqueda.</div>}</div>;
}

