import { CalendarDays, Sparkles } from "lucide-react";

export default function App() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
        <div className="mb-8 flex size-14 items-center justify-center rounded-2xl bg-indigo-600 text-white">
          <CalendarDays aria-hidden="true" size={26} />
        </div>
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Turnia · Fundación
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Una base lista para crecer.
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-8 text-slate-600">
          El espacio de trabajo de Turnia está preparado. Aquí construiremos una
          experiencia clara para organizar agendas y citas.
        </p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700">
          <Sparkles aria-hidden="true" size={16} />
          Fase 1 completada
        </div>
      </section>
    </main>
  );
}
