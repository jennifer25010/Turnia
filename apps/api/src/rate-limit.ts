/**
 * Limitador de intentos en memoria (ventana deslizante simple).
 *
 * Limitación conocida: el estado vive en el proceso, así que no se comparte
 * entre varias instancias de la API. Para un despliegue con varias réplicas
 * habrá que moverlo a Redis o a PostgreSQL.
 */
export type RateLimiter = {
  /** Registra un intento y devuelve `true` si todavía está permitido. */
  hit(key: string, now?: number): boolean;
  reset(key: string): void;
};

export function createRateLimiter(options: {
  maxAttempts: number;
  windowMs: number;
  maxKeys?: number;
}): RateLimiter {
  const attempts = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 10_000;

  function prune(now: number) {
    for (const [key, times] of attempts) {
      const recent = times.filter((time) => now - time < options.windowMs);
      if (recent.length === 0) attempts.delete(key);
      else attempts.set(key, recent);
    }
  }

  return {
    hit(key, now = Date.now()) {
      if (attempts.size >= maxKeys) prune(now);

      const recent = (attempts.get(key) ?? []).filter(
        (time) => now - time < options.windowMs,
      );
      recent.push(now);
      attempts.set(key, recent);

      return recent.length <= options.maxAttempts;
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}
