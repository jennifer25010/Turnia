import { useState } from "react";
import { CalendarDays, CircleAlert, LogIn } from "lucide-react";
import { fetchSession, loginRequest, type SessionInfo } from "./auth-api.js";

type LoginScreenProps = {
  onAuthenticated: (session: SessionInfo) => void;
};

export default function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");

    if (!email.trim() || !password) {
      setError("Escribe tu correo y tu contraseña.");
      return;
    }

    setIsSubmitting(true);
    try {
      await loginRequest(email.trim(), password);
      const session = await fetchSession();
      if (!session) {
        throw new Error(
          "La sesión no se pudo establecer. Revisa que el navegador acepte cookies.",
        );
      }
      setPassword("");
      onAuthenticated(session);
    } catch (caught) {
      setError(
        caught instanceof TypeError
          ? "No fue posible conectar con la API. Revisa que el servidor esté iniciado."
          : caught instanceof Error
            ? caught.message
            : "No se pudo iniciar sesión. Inténtalo de nuevo.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <CalendarDays size={22} />
          </span>
          <strong>Turnia</strong>
        </div>
        <h1 id="login-title">Inicia sesión</h1>
        <p className="login-subtitle">
          Accede al panel para gestionar la agenda de tu negocio.
        </p>

        {error && (
          <div className="login-error" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <label>
            Correo electrónico
            <input
              type="email"
              name="email"
              autoComplete="username"
              maxLength={254}
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@negocio.com"
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              maxLength={1024}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="primary-button login-submit"
            disabled={isSubmitting}
          >
            <LogIn size={17} aria-hidden="true" />{" "}
            {isSubmitting ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </section>
    </main>
  );
}
