import { useCallback, useEffect, useState } from "react";
import App from "./App";
import LoginScreen from "./LoginScreen";
import { fetchSession, logoutRequest, type SessionInfo } from "./auth-api.js";

type GateState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "error"; message: string }
  | { status: "ready"; session: SessionInfo };

/**
 * Decide qué mostrar según la sesión del servidor: pantalla de acceso,
 * panel o un mensaje cuando la cuenta no pertenece a ningún negocio.
 * La autorización real siempre ocurre en la API; esto solo evita mostrar un
 * panel que no podría cargar datos.
 */
export default function AuthGate() {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchSession()
      .then((session) => {
        if (cancelled) return;
        setState(
          session ? { status: "ready", session } : { status: "anonymous" },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            error instanceof TypeError
              ? "No fue posible conectar con la API. Revisa que el servidor esté iniciado."
              : error instanceof Error
                ? error.message
                : "No se pudo verificar la sesión.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Aun si la red falla, se vuelve a la pantalla de acceso; la sesión
      // del servidor expira sola y la cookie se renovará al iniciar de nuevo.
    }
    setState({ status: "anonymous" });
  }, []);

  const handleSessionExpired = useCallback(() => {
    setState({ status: "anonymous" });
  }, []);

  if (state.status === "loading") {
    return (
      <main className="login-page">
        <p role="status" className="login-status">
          Verificando la sesión…
        </p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="login-page">
        <section className="login-card" role="alert">
          <h1>No se pudo cargar Turnia</h1>
          <p className="login-subtitle">{state.message}</p>
          <button
            type="button"
            className="primary-button login-submit"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Reintentar
          </button>
        </section>
      </main>
    );
  }

  if (state.status === "anonymous") {
    return (
      <LoginScreen
        onAuthenticated={(session) => setState({ status: "ready", session })}
      />
    );
  }

  const membership = state.session.memberships[0];
  if (!membership) {
    return (
      <main className="login-page">
        <section className="login-card" role="alert">
          <h1>Tu cuenta no tiene acceso a ningún negocio</h1>
          <p className="login-subtitle">
            Pide a un administrador que te agregue a un negocio para poder ver y
            gestionar su agenda.
          </p>
          <button
            type="button"
            className="secondary-button login-submit"
            onClick={() => void handleLogout()}
          >
            Cerrar sesión
          </button>
        </section>
      </main>
    );
  }

  return (
    <App
      businessId={membership.businessId}
      businessName={membership.businessName}
      role={membership.role}
      user={state.session.user}
      onLogout={() => void handleLogout()}
      onSessionExpired={handleSessionExpired}
    />
  );
}
