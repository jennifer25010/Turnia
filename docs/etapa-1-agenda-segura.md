# Etapa 1: agenda segura y acceso

Documenta las reglas que implementa el servidor para reservar. La fuente de
verdad son el código (`apps/api/src/availability.ts`, `session.ts`, `app.ts`) y
las migraciones SQL; este documento resume las convenciones.

## Quién puede qué

| Recurso                    | Acceso                                                 |
| -------------------------- | ------------------------------------------------------ |
| `GET /api/v1/catalog`      | Público (servicios y empleados activos)                |
| `GET /api/v1/availability` | Público (solo intervalos libres, sin clientes)         |
| `GET /api/v1/bookings`     | Sesión + membresía en el negocio                       |
| `POST /api/v1/bookings`    | Sesión + membresía en el negocio (origen PANEL)        |
| `GET /api/v1/auth/me`      | Sesión; devuelve usuario y negocios con su rol         |
| `POST /api/v1/auth/login`  | Público, limitado a 10 intentos / 15 min (correo + IP) |

La autorización ocurre en el servidor (`authorizeBusinessAccess`). El frontend
solo decide qué pantalla mostrar. Las sesiones usan una cookie `HttpOnly`,
`SameSite=Lax` (y `Secure` en producción); en base de datos solo se guarda el
hash SHA-256 del token.

## Convenciones de agenda

- `weekday`: 0 = domingo ... 6 = sábado.
- `startMinute` / `endMinute`: minutos desde las 00:00 en la zona horaria del
  negocio; `endMinute` exclusivo y máximo 1440.
- Los intervalos son semiabiertos `[inicio, fin)`: una cita que termina a las
  10:30 no choca con otra que empieza a las 10:30.
- Una hora es reservable solo si cabe dentro del horario del negocio **y** del
  horario del empleado ese día. Un empleado sin horarios configurados no
  ofrece disponibilidad.
- Se rechazan: horas pasadas, horas con segundos, cierres del negocio y
  ausencias del empleado (`422 SLOT_UNAVAILABLE` con `details.reason`).

## Reservas simultáneas

El servidor valida agenda antes de insertar, pero **la garantía contra dobles
reservas la da PostgreSQL**: la restricción de exclusión
`booking_staff_no_overlapping_active` impide dos reservas activas
(`PENDING`/`CONFIRMED`) que se solapen para el mismo empleado. El conflicto se
traduce a `409 BOOKING_CONFLICT`. Las reservas `CANCELLED`, `COMPLETED`,
`NO_SHOW` y `EXPIRED` no bloquean el horario.

## Migración `20261031150000_schedule_integrity_checks`

Añade restricciones `CHECK` (no destructivas). Antes de aplicarla, comprueba en
pgAdmin que ninguna fila existente las incumple; cada consulta debe devolver 0:

```sql
SELECT count(*) FROM "BusinessHours"
 WHERE NOT ("weekday" BETWEEN 0 AND 6 AND "startMinute" >= 0
            AND "endMinute" <= 1440 AND "startMinute" < "endMinute");
SELECT count(*) FROM "StaffAvailability"
 WHERE NOT ("weekday" BETWEEN 0 AND 6 AND "startMinute" >= 0
            AND "endMinute" <= 1440 AND "startMinute" < "endMinute");
SELECT count(*) FROM "BusinessClosure" WHERE NOT ("startsAt" < "endsAt");
SELECT count(*) FROM "TimeOff"         WHERE NOT ("startsAt" < "endsAt");
SELECT count(*) FROM "Booking"         WHERE NOT ("startsAt" < "endsAt");
SELECT count(*) FROM "Service"         WHERE NOT ("durationMinutes" > 0 AND "price" >= 0);
```

## Limitaciones conocidas de esta etapa

- El limitador de intentos de login vive en memoria del proceso (no se comparte
  entre réplicas).
- No existe aún registro de usuarios, recuperación de contraseña, rol de
  cliente ni gestión de horarios desde la interfaz (se cargan por seed o SQL).
- Las reservas `PENDING` con `holdExpiresAt` vencido todavía no se expiran
  automáticamente (no hay tarea programada).
- El panel usa el primer negocio de la cuenta; falta selector de negocio.
