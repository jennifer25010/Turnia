import { useState } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { fetchSession, loginRequest, type SessionInfo } from "./auth-api.js";

type LoginScreenProps = {
  onAuthenticated: (session: SessionInfo) => void;
};

export default function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Solo presentación: alterna la visibilidad del texto de la contraseña.
  const [showPassword, setShowPassword] = useState(false);

  // Solo presentación: marca visualmente un campo vacío mientras hay un error.
  const missingEmail = Boolean(error) && !email.trim();
  const missingPassword = Boolean(error) && !password;

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
      <header className="login-topbar">
        <img
          className="login-logo-top"
          src="/brand/logo-horizontal.png"
          alt="Turnia"
          width={160}
          height={58}
        />
        <span className="login-tagline">Tu agenda, siempre en orden</span>
      </header>

      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <img
            className="login-logo-card"
            src="/brand/logo-mark.png"
            alt=""
            width={96}
            height={82}
          />
        </div>
        <h1 id="login-title">Bienvenido</h1>
        <p className="login-subtitle">
          Accede al panel para gestionar la agenda de tu negocio.
        </p>

        {error && (
          <div className="login-error" role="alert" id="login-error">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <label>
            Correo electrónico
            <span className="login-field">
              <span className="login-field-icon" aria-hidden="true">
                <Mail size={18} />
              </span>
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
                aria-invalid={missingEmail}
                aria-describedby={error ? "login-error" : undefined}
              />
            </span>
          </label>
          <label>
            Contraseña
            <span className="login-field">
              <span className="login-field-icon" aria-hidden="true">
                <Lock size={18} />
              </span>
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                maxLength={1024}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Tu contraseña"
                aria-invalid={missingPassword}
                aria-describedby={error ? "login-error" : undefined}
              />
              <button
                type="button"
                className="login-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={
                  showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                }
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </span>
          </label>
          <button
            type="submit"
            className="primary-button login-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Ingresando…" : "Ingresar"}
            {!isSubmitting && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>

        <p className="login-footnote">
          ¿Problemas para ingresar? Contacta al administrador de tu negocio.
        </p>
      </section>
    </main>
  );
}
