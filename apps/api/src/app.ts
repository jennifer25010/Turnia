import express from "express";
import type { ErrorRequestHandler } from "express";
import { prisma } from "./lib/prisma.js";
import {
  createSessionToken,
  hashSessionToken,
  verifyPassword,
} from "./auth.js";
import {
  SESSION_DURATION_MS,
  authorizeBusinessAccess,
  bookingScopeFor,
  clearedSessionCookie,
  readSessionCookie,
  sessionCookie,
} from "./session.js";
import { isManagerRole } from "./booking-rules.js";
import { bookingSummarySelect } from "./booking-select.js";
import { bookingManagementRouter } from "./booking-management.routes.js";
import { staffLinksRouter } from "./staff-links.routes.js";
import { businessSettingsRouter } from "./business-settings.routes.js";
import { slotRejectionMessages } from "./slot-messages.js";
import {
  checkSlot,
  dayBounds,
  getBookableSlots,
  isValidDateString,
  isValidTimeZone,
} from "./availability.js";
import { createRateLimiter } from "./rate-limit.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json());

// Patrón para validar UUID.
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Health check de la API.
app.get("/api/v1/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
  });
});

// Health check de la conexión a PostgreSQL.
app.get("/api/v1/health/db", async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;

  response.status(200).json({
    status: "ok",
    database: "connected",
  });
});

// Middleware centralizado de errores.
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  void _next;
  const candidate =
    typeof error === "object" && error !== null
      ? (error as {
          status?: unknown;
          statusCode?: unknown;
          message?: unknown;
        })
      : {};

  const suppliedStatus = candidate.status ?? candidate.statusCode;

  const status =
    typeof suppliedStatus === "number" &&
    Number.isInteger(suppliedStatus) &&
    suppliedStatus >= 400 &&
    suppliedStatus <= 599
      ? suppliedStatus
      : 500;

  const message =
    status >= 500 && process.env.NODE_ENV === "production"
      ? "Error interno del servidor"
      : typeof candidate.message === "string"
        ? candidate.message
        : "Error interno del servidor";

  response.status(status).json({
    error: {
      code: status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST",
      message,
    },
  });
};

// Límite de intentos de inicio de sesión: 10 por correo+IP cada 15 minutos.
const loginLimiter = createRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
});

app.post("/api/v1/auth/login", async (request, response) => {
  const body: unknown = request.body;

  if (
    typeof body !== "object" ||
    body === null ||
    !("email" in body) ||
    !("password" in body) ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    body.email.trim().length > 254 ||
    body.password.length === 0 ||
    body.password.length > 1024
  ) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Debes proporcionar un correo y una contraseña válidos.",
      },
    });
    return;
  }

  const emailNormalized = body.email.trim().toLowerCase();

  const limiterKey = `${request.ip ?? "unknown"}|${emailNormalized}`;
  if (!loginLimiter.hit(limiterKey)) {
    response.status(429).json({
      error: {
        code: "TOO_MANY_ATTEMPTS",
        message:
          "Demasiados intentos de inicio de sesión. Espera unos minutos e inténtalo de nuevo.",
      },
    });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { emailNormalized },
    select: {
      id: true,
      email: true,
      fullName: true,
      passwordHash: true,
      active: true,
    },
  });

  const passwordValid = user
    ? await verifyPassword(body.password, user.passwordHash)
    : false;

  if (!user || !user.active || !passwordValid) {
    response.status(401).json({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Correo o contraseña incorrectos.",
      },
    });
    return;
  }

  loginLimiter.reset(limiterKey);

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    },
  });

  response.setHeader(
    "Set-Cookie",
    sessionCookie(token, SESSION_DURATION_MS / 1000),
  );

  response.status(200).json({
    data: {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      expiresAt: expiresAt.toISOString(),
    },
  });
});

app.get("/api/v1/auth/me", async (request, response) => {
  const token = readSessionCookie(request.headers.cookie);

  if (!token) {
    response.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Debes iniciar sesión.",
      },
    });
    return;
  }

  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          active: true,
          memberships: {
            orderBy: { createdAt: "asc" },
            select: {
              role: true,
              business: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  timezone: true,
                  active: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!session || !session.user.active) {
    response.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "La sesión no es válida o ha expirado.",
      },
    });
    return;
  }

  const memberships = (session.user.memberships ?? [])
    .filter((membership) => membership.business.active)
    .map((membership) => ({
      businessId: membership.business.id,
      businessName: membership.business.name,
      businessSlug: membership.business.slug,
      timezone: membership.business.timezone,
      role: membership.role,
    }));

  response.status(200).json({
    data: {
      user: {
        id: session.user.id,
        email: session.user.email,
        fullName: session.user.fullName,
      },
      memberships,
      expiresAt: session.expiresAt.toISOString(),
    },
  });
});

app.post("/api/v1/auth/logout", async (request, response) => {
  const token = readSessionCookie(request.headers.cookie);

  if (token) {
    await prisma.session.updateMany({
      where: {
        tokenHash: hashSessionToken(token),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  response.setHeader("Set-Cookie", clearedSessionCookie());
  response.status(200).json({ data: { loggedOut: true } });
});
/**
 * Lista las reservas de un negocio. Requiere sesión y membresía; el alcance
 * depende del rol (ver `bookingScopeFor`).
 */
app.get("/api/v1/bookings", async (request, response) => {
  const businessId = request.query.businessId;

  if (typeof businessId !== "string" || !uuidPattern.test(businessId)) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Debes proporcionar un businessId válido",
      },
    });
    return;
  }

  const access = await authorizeBusinessAccess(request, response, businessId);
  if (!access) return;

  // OWNER/ADMIN ven todo el negocio; STAFF solo las reservas de su empleado
  // vinculado. Un STAFF sin vínculo no obtiene ninguna reserva.
  const scope = await bookingScopeFor(access, businessId);

  const bookings =
    scope.kind === "UNLINKED"
      ? []
      : await prisma.booking.findMany({
          where: {
            businessId,
            ...(scope.kind === "OWN" ? { staffId: scope.staffId } : {}),
          },
          orderBy: { startsAt: "asc" },
          select: bookingSummarySelect,
        });

  response.status(200).json({
    data: bookings,
    meta: {
      scope: scope.kind,
      role: access.role,
      ...(scope.kind === "OWN" ? { staffId: scope.staffId } : {}),
    },
  });
});

/**
 * Catálogo de un negocio: servicios activos y empleados
 * activos con los servicios que tienen asignados.
 * Temporalmente usa businessId mientras se implementa
 * la autenticación.
 */
app.get("/api/v1/catalog", async (request, response) => {
  const businessId = request.query.businessId;

  if (typeof businessId !== "string" || !uuidPattern.test(businessId)) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Debes proporcionar un businessId válido",
      },
    });
    return;
  }

  const business = await prisma.business.findFirst({
    where: {
      id: businessId,
      active: true,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      currency: true,
      services: {
        where: { active: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          durationMinutes: true,
          price: true,
          staffServices: {
            select: {
              staff: {
                select: {
                  id: true,
                  displayName: true,
                },
              },
            },
          },
        },
      },
      staff: {
        where: { active: true },
        orderBy: { displayName: "asc" },
        select: {
          id: true,
          displayName: true,
          staffServices: {
            select: {
              serviceId: true,
            },
          },
        },
      },
    },
  });

  if (!business) {
    response.status(404).json({
      error: {
        code: "BUSINESS_NOT_FOUND",
        message: "El negocio no existe o está inactivo",
      },
    });
    return;
  }

  response.status(200).json({
    data: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      timezone: business.timezone,
      currency: business.currency,
      services: business.services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        price: service.price,
        staff: service.staffServices.map((assignment) => assignment.staff),
      })),
      staff: business.staff.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        serviceIds: member.staffServices.map(
          (assignment) => assignment.serviceId,
        ),
      })),
    },
  });
});

// Crear una reserva. Requiere sesión y membresía en el negocio.
app.post("/api/v1/bookings", async (request, response) => {
  const body: unknown = request.body;

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "El cuerpo debe ser un objeto JSON",
      },
    });
    return;
  }

  const input = body as Record<string, unknown>;

  const {
    businessId,
    serviceId,
    staffId,
    startsAt,
    name,
    email,
    phone,
    notes,
  } = input;

  // Validar los campos obligatorios.
  if (
    typeof businessId !== "string" ||
    !uuidPattern.test(businessId) ||
    typeof serviceId !== "string" ||
    !uuidPattern.test(serviceId) ||
    typeof staffId !== "string" ||
    !uuidPattern.test(staffId) ||
    typeof startsAt !== "string" ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 150
  ) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Revisa businessId, serviceId, staffId, startsAt y name",
      },
    });
    return;
  }

  // Validar los campos opcionales.
  if (
    (email !== undefined &&
      (typeof email !== "string" || email.length > 254)) ||
    (phone !== undefined && (typeof phone !== "string" || phone.length > 40)) ||
    (notes !== undefined && (typeof notes !== "string" || notes.length > 2000))
  ) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "email, phone o notes tienen un formato inválido",
      },
    });
    return;
  }

  // Normalizar y validar el correo electrónico.
  const normalizedEmail =
    typeof email === "string" && email.trim()
      ? email.trim().toLowerCase()
      : null;

  if (
    normalizedEmail !== null &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "El correo electrónico no tiene un formato válido",
      },
    });
    return;
  }

  // Validar fecha y hora ISO.
  const start = new Date(startsAt);

  if (
    !Number.isFinite(start.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(startsAt)
  ) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "startsAt debe ser una fecha ISO válida con hora",
      },
    });
    return;
  }

  const normalizedPhone =
    typeof phone === "string" && phone.trim() ? phone.trim() : null;

  // Crear reservas desde el panel exige sesión y membresía en el negocio.
  const access = await authorizeBusinessAccess(request, response, businessId);
  if (!access) return;

  // Un STAFF solo agenda citas para el empleado vinculado a su usuario.
  if (!isManagerRole(access.role)) {
    const scope = await bookingScopeFor(access, businessId);
    if (scope.kind !== "OWN" || scope.staffId !== staffId) {
      response.status(403).json({
        error: {
          code: "STAFF_SCOPE",
          message:
            "Solo puedes crear reservas asignadas a tu propio perfil de empleado.",
        },
      });
      return;
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Verificar que el negocio exista y esté activo.
      const business = await tx.business.findFirst({
        where: {
          id: businessId,
          active: true,
        },
        select: {
          id: true,
          bookingHoldMinutes: true,
          timezone: true,
        },
      });

      // Verificar que el servicio pertenezca al negocio.
      const service = await tx.service.findFirst({
        where: {
          id: serviceId,
          businessId,
          active: true,
        },
      });

      // Verificar que el empleado pertenezca al negocio.
      const staff = await tx.staff.findFirst({
        where: {
          id: staffId,
          businessId,
          active: true,
        },
      });

      if (!business || !service || !staff) {
        return { kind: "invalid" as const };
      }

      // Verificar que el empleado pueda realizar el servicio.
      const assignment = await tx.staffService.findUnique({
        where: {
          staffId_serviceId: {
            staffId,
            serviceId,
          },
        },
      });

      if (!assignment || assignment.businessId !== businessId) {
        return { kind: "invalid" as const };
      }

      // Calcular la hora de finalización.
      const end = new Date(start.getTime() + service.durationMinutes * 60_000);

      // Validar horarios del negocio y del profesional, cierres y ausencias.
      // Los choques con otras reservas los resuelve PostgreSQL (restricción
      // de exclusión), que es la única defensa segura ante concurrencia.
      const timeZone = isValidTimeZone(business.timezone)
        ? business.timezone
        : "America/Bogota";

      const businessWindows = await tx.businessHours.findMany({
        where: { businessId, active: true },
        select: { weekday: true, startMinute: true, endMinute: true },
      });
      const staffWindows = await tx.staffAvailability.findMany({
        where: { staffId, active: true },
        select: { weekday: true, startMinute: true, endMinute: true },
      });
      const closures = await tx.businessClosure.findMany({
        where: { businessId, startsAt: { lt: end }, endsAt: { gt: start } },
        select: { startsAt: true, endsAt: true },
      });
      const timeOffs = await tx.timeOff.findMany({
        where: { staffId, startsAt: { lt: end }, endsAt: { gt: start } },
        select: { startsAt: true, endsAt: true },
      });

      const verdict = checkSlot({
        timeZone,
        startsAt: start,
        durationMinutes: service.durationMinutes,
        businessWindows,
        staffWindows,
        closures: closures.map((item) => ({
          start: item.startsAt,
          end: item.endsAt,
        })),
        timeOffs: timeOffs.map((item) => ({
          start: item.startsAt,
          end: item.endsAt,
        })),
        now: new Date(),
      });

      if (!verdict.ok) {
        return { kind: "unavailable" as const, reason: verdict.reason };
      }

      // Buscar al cliente por correo o teléfono dentro del negocio.
      let customer = null;

      if (normalizedEmail) {
        customer = await tx.customer.findFirst({
          where: {
            businessId,
            email: {
              equals: normalizedEmail,
              mode: "insensitive",
            },
          },
        });
      }

      if (!customer && normalizedPhone) {
        customer = await tx.customer.findFirst({
          where: {
            businessId,
            phone: normalizedPhone,
          },
        });
      }

      // Crear o actualizar los datos del cliente.
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            businessId,
            name: name.trim(),
            email: normalizedEmail,
            phone: normalizedPhone,
          },
        });
      } else {
        customer = await tx.customer.update({
          where: {
            id: customer.id,
          },
          data: {
            name: name.trim(),
            ...(normalizedEmail ? { email: normalizedEmail } : {}),
            ...(normalizedPhone ? { phone: normalizedPhone } : {}),
          },
        });
      }

      // Crear la reserva.
      const booking = await tx.booking.create({
        data: {
          businessId,
          customerId: customer.id,
          serviceId,
          staffId,
          createdByUserId: access.userId,
          source: "PANEL",
          status: "CONFIRMED",

          customerNameSnapshot: customer.name,
          customerEmailSnapshot: customer.email,
          customerPhoneSnapshot: customer.phone,

          serviceNameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes,
          priceSnapshot: service.price,

          startsAt: start,
          endsAt: end,

          notes:
            typeof notes === "string" && notes.trim() ? notes.trim() : null,

          confirmedAt: new Date(),
          holdExpiresAt: null,
        },
        select: {
          id: true,
          businessId: true,
          customerId: true,
          serviceId: true,
          staffId: true,
          status: true,
          customerNameSnapshot: true,
          serviceNameSnapshot: true,
          durationMinutesSnapshot: true,
          priceSnapshot: true,
          startsAt: true,
          endsAt: true,
          notes: true,
          createdAt: true,
        },
      });

      // Auditoría en la MISMA transacción: si el evento falla, la reserva no
      // se guarda.
      await tx.bookingEvent.create({
        data: {
          businessId,
          bookingId: booking.id,
          type: "CREATED",
          actorType: "USER",
          actorUserId: access.userId,
          toStatus: "CONFIRMED",
          data: {
            after: {
              startsAt: booking.startsAt.toISOString(),
              endsAt: booking.endsAt.toISOString(),
              serviceId: booking.serviceId,
              staffId: booking.staffId,
              source: "PANEL",
            },
          },
        },
      });

      return {
        kind: "created" as const,
        booking,
      };
    });

    // Referencias inválidas.
    if (result.kind === "invalid") {
      response.status(400).json({
        error: {
          code: "INVALID_BOOKING_REFERENCE",
          message:
            "El negocio, servicio o empleado no existe, está inactivo o no corresponde al servicio",
        },
      });
      return;
    }

    // Horario fuera de la agenda del negocio o del profesional.
    if (result.kind === "unavailable") {
      response.status(422).json({
        error: {
          code: "SLOT_UNAVAILABLE",
          message: slotRejectionMessages[result.reason],
          details: { reason: result.reason },
        },
      });
      return;
    }

    // Reserva creada correctamente.
    response.status(201).json({
      data: result.booking,
    });
  } catch (error: unknown) {
    // Examinar el mensaje y los datos del error de Prisma.
    const candidate =
      typeof error === "object" && error !== null
        ? (error as {
            code?: unknown;
            message?: unknown;
            meta?: unknown;
            cause?: unknown;
            stack?: unknown;
          })
        : {};

    const errorParts: string[] = [];

    if (error instanceof Error) {
      errorParts.push(error.message);
      errorParts.push(error.stack ?? "");
    }

    for (const value of [
      candidate.code,
      candidate.message,
      candidate.meta,
      candidate.cause,
      candidate.stack,
    ]) {
      if (typeof value === "string") {
        errorParts.push(value);
      } else if (typeof value === "object" && value !== null) {
        try {
          errorParts.push(JSON.stringify(value));
        } catch {
          // Ignorar valores que no se puedan serializar.
        }
      }
    }

    const errorText = errorParts.join(" ");

    // Detectar conflictos de horario reportados por PostgreSQL.
    if (
      errorText.includes("23P01") ||
      errorText.includes("booking_staff_no_overlapping_active")
    ) {
      response.status(409).json({
        error: {
          code: "BOOKING_CONFLICT",
          message: "El empleado ya tiene una reserva en ese horario.",
        },
      });
      return;
    }

    // Los demás errores pasan al middleware centralizado.
    throw error;
  }
});

/**
 * Horarios disponibles de un servicio con un empleado en una fecha local del
 * negocio. Es pública (como el catálogo) y solo expone intervalos libres, sin
 * datos de clientes.
 */
app.get("/api/v1/availability", async (request, response) => {
  const { businessId, serviceId, staffId, date, excludeBookingId } =
    request.query;

  if (
    typeof businessId !== "string" ||
    !uuidPattern.test(businessId) ||
    typeof serviceId !== "string" ||
    !uuidPattern.test(serviceId) ||
    typeof staffId !== "string" ||
    !uuidPattern.test(staffId) ||
    typeof date !== "string" ||
    !isValidDateString(date) ||
    (excludeBookingId !== undefined &&
      (typeof excludeBookingId !== "string" ||
        !uuidPattern.test(excludeBookingId)))
  ) {
    response.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message:
          "Revisa businessId, serviceId, staffId, date (AAAA-MM-DD) y excludeBookingId",
      },
    });
    return;
  }

  const business = await prisma.business.findFirst({
    where: { id: businessId, active: true },
    select: { id: true, timezone: true },
  });
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId, active: true },
    select: { id: true, durationMinutes: true },
  });
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, businessId, active: true },
    select: { id: true },
  });
  const assignment =
    business && service && staff
      ? await prisma.staffService.findUnique({
          where: { staffId_serviceId: { staffId, serviceId } },
        })
      : null;

  if (!business || !service || !staff || !assignment) {
    response.status(400).json({
      error: {
        code: "INVALID_BOOKING_REFERENCE",
        message:
          "El negocio, servicio o empleado no existe, está inactivo o no corresponde al servicio",
      },
    });
    return;
  }

  const timeZone = isValidTimeZone(business.timezone)
    ? business.timezone
    : "America/Bogota";
  const day = dayBounds(date, timeZone);

  const businessWindows = await prisma.businessHours.findMany({
    where: { businessId, active: true },
    select: { weekday: true, startMinute: true, endMinute: true },
  });
  const staffWindows = await prisma.staffAvailability.findMany({
    where: { staffId, active: true },
    select: { weekday: true, startMinute: true, endMinute: true },
  });
  const closures = await prisma.businessClosure.findMany({
    where: { businessId, startsAt: { lt: day.end }, endsAt: { gt: day.start } },
    select: { startsAt: true, endsAt: true },
  });
  const timeOffs = await prisma.timeOff.findMany({
    where: { staffId, startsAt: { lt: day.end }, endsAt: { gt: day.start } },
    select: { startsAt: true, endsAt: true },
  });
  const activeBookings = await prisma.booking.findMany({
    where: {
      staffId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { lt: day.end },
      endsAt: { gt: day.start },
      // Al modificar una cita, su propio horario actual no debe bloquearla.
      ...(typeof excludeBookingId === "string"
        ? { id: { not: excludeBookingId } }
        : {}),
    },
    select: { startsAt: true, endsAt: true },
  });

  const slots = getBookableSlots({
    timeZone,
    date,
    durationMinutes: service.durationMinutes,
    businessWindows,
    staffWindows,
    blocked: [...closures, ...timeOffs, ...activeBookings].map((item) => ({
      start: item.startsAt,
      end: item.endsAt,
    })),
    now: new Date(),
  });

  response.status(200).json({
    data: {
      date,
      timeZone,
      durationMinutes: service.durationMinutes,
      slots,
    },
  });
});

// Gestión de reservas, vínculos de empleados y políticas del negocio.
app.use("/api/v1", bookingManagementRouter);
app.use("/api/v1", staffLinksRouter);
app.use("/api/v1", businessSettingsRouter);

// Ruta 404 para endpoints inexistentes.
app.use((_request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Ruta no encontrada",
    },
  });
});

// Middleware de errores al final de las rutas.
app.use(errorHandler);
