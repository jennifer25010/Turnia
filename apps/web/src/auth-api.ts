export type MembershipRole = "OWNER" | "ADMIN" | "STAFF";

export type SessionMembership = {
  businessId: string;
  businessName: string;
  businessSlug: string;
  timezone: string;
  role: MembershipRole;
};

export type SessionInfo = {
  user: { id: string; email: string; fullName: string };
  memberships: SessionMembership[];
};

const roles: readonly string[] = ["OWNER", "ADMIN", "STAFF"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMembership(value: unknown): SessionMembership | null {
  if (!isRecord(value)) return null;
  const { businessId, businessName, businessSlug, timezone, role } = value;
  if (
    typeof businessId !== "string" ||
    typeof businessName !== "string" ||
    typeof businessSlug !== "string" ||
    typeof timezone !== "string" ||
    typeof role !== "string" ||
    !roles.includes(role)
  ) {
    return null;
  }
  return {
    businessId,
    businessName,
    businessSlug,
    timezone,
    role: role as MembershipRole,
  };
}

export function parseSessionInfo(body: unknown): SessionInfo | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const { user, memberships } = body.data;
  if (
    !isRecord(user) ||
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.fullName !== "string" ||
    !Array.isArray(memberships)
  ) {
    return null;
  }
  const parsed = memberships.map(parseMembership);
  if (parsed.some((item) => item === null)) return null;
  return {
    user: { id: user.id, email: user.email, fullName: user.fullName },
    memberships: parsed as SessionMembership[],
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Consulta la sesión actual. Devuelve `null` cuando no hay sesión válida
 * (HTTP 401) y lanza un error ante cualquier otro fallo.
 */
export async function fetchSession(
  request: typeof fetch = fetch,
): Promise<SessionInfo | null> {
  const response = await request("/api/v1/auth/me", {
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(
      `No se pudo verificar la sesión (código ${response.status}).`,
    );
  }
  const session = parseSessionInfo(await readJson(response));
  if (!session) {
    throw new Error("El servidor respondió con un formato inesperado.");
  }
  return session;
}

/** Inicia sesión. La API establece la cookie HttpOnly de sesión. */
export async function loginRequest(
  email: string,
  password: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.ok) return;

  const body = await readJson(response);
  const apiMessage =
    isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.message === "string"
      ? body.error.message
      : null;

  if (response.status === 401) {
    throw new Error("Correo o contraseña incorrectos.");
  }
  if (response.status === 429 || response.status === 400) {
    throw new Error(
      apiMessage ?? "No se pudo iniciar sesión. Revisa los datos.",
    );
  }
  throw new Error("No se pudo iniciar sesión. Inténtalo de nuevo.");
}

/** Cierra la sesión en el servidor (revoca el token y limpia la cookie). */
export async function logoutRequest(
  request: typeof fetch = fetch,
): Promise<void> {
  await request("/api/v1/auth/logout", { method: "POST" });
}
