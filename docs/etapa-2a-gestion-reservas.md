# Etapa 2A: gestión de reservas desde el panel

Cancelar, modificar y cambiar el estado de reservas, con historial de
auditoría, permisos por rol y por empleado, y avisos mínimos configurables.
Requiere la Etapa 1 (`docs/etapa-1-agenda-segura.md`). La fuente de verdad es
el código; este documento resume las decisiones.

## Permisos

| Rol / situación                     | Alcance                                                         |
| ----------------------------------- | --------------------------------------------------------------- |
| OWNER y ADMIN                       | Todas las reservas de **su** negocio                            |
| STAFF vinculado (`Staff.userId`)    | Solo reservas asignadas a **su** empleado                       |
| STAFF sin vincular                  | Ninguna reserva (lista vacía; detalle y acciones responden 404) |
| Usuario sin membresía en el negocio | 404 (no se revela si la reserva existe)                         |

- La autorización se resuelve en el servidor **a partir de la reserva**, nunca
  de un `businessId` enviado por el cliente (`resolveBookingAccess`).
- Solo OWNER/ADMIN: cambiar el empleado de una reserva, gestionar vínculos
  Staff↔usuario, editar políticas, omitir avisos mínimos.
- STAFF solo crea reservas asignadas a su propio empleado (`STAFF_SCOPE`).
- Un rol desconocido o ausente falla cerrado (no ve reservas).

## Endpoints (todos exigen sesión)

| Método y ruta                               | Descripción                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/v1/bookings`                      | Lista según alcance; `meta.scope` = ALL / OWN / UNLINKED                      |
| `GET /api/v1/bookings/:id`                  | Detalle + historial + permisos efectivos                                      |
| `POST /api/v1/bookings/:id/cancel`          | `{expectedVersion, reason?, override?}`                                       |
| `PATCH /api/v1/bookings/:id`                | `{expectedVersion, startsAt?, serviceId?, staffId?, reason?, override?}`      |
| `POST /api/v1/bookings/:id/status`          | `{expectedVersion, status, reason?}` (CONFIRMED, COMPLETED, NO_SHOW, EXPIRED) |
| `GET /api/v1/availability`                  | Ahora acepta `excludeBookingId` (la cita no se bloquea a sí misma)            |
| `GET/PATCH /api/v1/businesses/:id/settings` | Avisos mínimos (OWNER/ADMIN)                                                  |
| `GET /api/v1/staff?businessId=`             | Empleados y cuenta vinculada (OWNER/ADMIN)                                    |
| `PUT /api/v1/staff/:id/user`                | `{email}` vincula, `{email:null}` desvincula (OWNER/ADMIN)                    |

Códigos de error estables: `STALE_BOOKING` (409), `INVALID_STATE` (409),
`BOOKING_CONFLICT` (409), `NOTICE_REQUIRED` (422), `OVERRIDE_NOT_ALLOWED`
(403), `REASON_REQUIRED` (400), `SLOT_UNAVAILABLE` (422),
`BOOKING_ALREADY_STARTED` / `BOOKING_ALREADY_ENDED` / `BOOKING_NOT_STARTED`
(422), `STAFF_CHANGE_NOT_ALLOWED` (403), `STAFF_SCOPE` (403), `NO_CHANGES`
(400), `USE_CANCEL_ENDPOINT` (400).

## Reglas de negocio

- **Estados:** PENDING → CONFIRMED | CANCELLED | EXPIRED; CONFIRMED →
  CANCELLED | COMPLETED | NO_SHOW. Los estados finales son inmutables (no hay
  reactivación: podría chocar con otra reserva que tomó el horario).
- COMPLETED y NO_SHOW solo después de la hora de inicio.
- Cancelar: reserva activa que aún no terminó. Modificar: reserva activa que
  aún no empezó. Cancelar por `/status` no se permite (evita saltarse el aviso).
- **Aviso mínimo** (`Business.cancellationNoticeMinutes` /
  `rescheduleNoticeMinutes`, 0 = sin restricción): deben faltar al menos esos
  minutos (el valor exacto es válido). OWNER/ADMIN pueden omitirlo enviando
  `override: true` **y** un motivo de al menos 5 caracteres; STAFF nunca. La
  excepción se guarda en `BookingEvent.data.override` con la restricción, el
  aviso exigido, el real y quién la autorizó. Si el aviso se cumple, un
  `override` enviado se ignora y no se registra.
- Al modificar: si el servicio no cambia se conservan duración y precio
  acordados; si cambia, se toman del nuevo servicio (queda en el evento).

## Concurrencia y atomicidad

- Cada cambio es un `UPDATE ... WHERE id AND version = :esperada AND status IN
(estados válidos)`. Si otra operación se adelantó afecta 0 filas → 409
  `STALE_BOOKING`. Dos usuarios nunca sobrescriben el trabajo del otro.
- El cambio y su `BookingEvent` se escriben con el **mismo cliente de
  transacción** (`prisma.$transaction`). Si el evento falla, el cambio se
  revierte. Crear una reserva también escribe su evento `CREATED`.
- Los choques de horario los decide PostgreSQL (restricción de exclusión);
  llegan como 409 `BOOKING_CONFLICT`.
- `BookingEvent` es de solo inserción (trigger) y no se borra en cascada.

## Historial de reservas anteriores

No se rellena: la migración no crea eventos. Una reserva sin evento `CREATED`
se muestra con el aviso "su historial completo no está disponible; los cambios
se registran desde ahora".

## Seguridad adicional

- Cookie `HttpOnly` + `SameSite=Lax`; las rutas aceptan solo JSON y no hay CORS
  habilitado, por lo que un sitio externo no puede enviar solicitudes que usen
  la sesión.
- Entradas validadas (UUID, enteros, longitud del motivo ≤ 500, campos
  desconocidos rechazados en políticas).

## Limitaciones conocidas (pendientes)

- Sin limitador de tasa en los endpoints de gestión (solo en el login).
- Los cambios de políticas y de vínculos Staff↔usuario no generan auditoría
  propia (solo las reservas tienen historial).
- No hay pantalla para crear usuarios ni asignarles membresías: la cuenta debe
  existir ya en el negocio (seed o SQL).
- Listado de reservas sin paginación.
- Sin notificaciones al cliente al cancelar o modificar (Etapa 2B).
- La Etapa 2B (reservas públicas, enlaces seguros por correo, correo) no está
  implementada.

## Verificación contra PostgreSQL real

`sh scripts/verify-stage2-db.sh` crea una base temporal, aplica las
migraciones (incluida una actualización con reservas existentes), comprueba
restricciones, inmutabilidad del historial, atomicidad (rollback si falla el
evento) y concurrencia (cancelaciones dobles, cancelar vs modificar, 20
modificaciones al mismo horario, intercambios simultáneos) y la elimina.
