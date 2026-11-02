import { fileURLToPath } from "node:url";
import dotenv from "../apps/api/node_modules/dotenv/lib/main.js";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../apps/api/src/auth.js";

// Carga el .env de la raíz sin importar desde dónde se ejecute el seed.
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const prisma = new PrismaClient();

async function main() {
  const business = await prisma.business.upsert({
    where: { slug: "turnia-demo" },
    update: {},
    create: {
      name: "Turnia Demo",
      slug: "turnia-demo",
      timezone: "America/Bogota",
      currency: "COP",
    },
  });

  let service = await prisma.service.findFirst({
    where: {
      businessId: business.id,
      name: "Corte de cabello",
    },
  });

  if (!service) {
    service = await prisma.service.create({
      data: {
        businessId: business.id,
        name: "Corte de cabello",
        description: "Servicio de prueba de Turnia",
        durationMinutes: 30,
        price: 25000,
      },
    });
  }

  let staff = await prisma.staff.findFirst({
    where: {
      businessId: business.id,
      displayName: "Empleado Demo",
    },
  });

  if (!staff) {
    staff = await prisma.staff.create({
      data: {
        businessId: business.id,
        displayName: "Empleado Demo",
      },
    });
  }

  await prisma.staffService.upsert({
    where: {
      staffId_serviceId: {
        staffId: staff.id,
        serviceId: service.id,
      },
    },
    update: {},
    create: {
      businessId: business.id,
      staffId: staff.id,
      serviceId: service.id,
    },
  });

  // Horarios por defecto (lunes a sábado, 08:00-18:00) solo si el negocio y el
  // empleado todavía no tienen ninguno. Weekday: 0 = domingo ... 6 = sábado.
  const defaultWindows = [1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    startMinute: 8 * 60,
    endMinute: 18 * 60,
  }));

  const existingBusinessHours = await prisma.businessHours.count({
    where: { businessId: business.id },
  });
  if (existingBusinessHours === 0) {
    await prisma.businessHours.createMany({
      data: defaultWindows.map((window) => ({
        ...window,
        businessId: business.id,
      })),
    });
  }

  const existingStaffAvailability = await prisma.staffAvailability.count({
    where: { staffId: staff.id },
  });
  if (existingStaffAvailability === 0) {
    await prisma.staffAvailability.createMany({
      data: defaultWindows.map((window) => ({ ...window, staffId: staff.id })),
    });
  }

  // Usuario propietario opcional: solo si se definen las tres variables en
  // .env. La contraseña nunca se guarda en el código; se almacena con scrypt.
  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  const ownerName = process.env.SEED_OWNER_NAME?.trim();

  if (ownerEmail && ownerPassword && ownerName) {
    const owner =
      (await prisma.user.findUnique({
        where: { emailNormalized: ownerEmail },
      })) ??
      (await prisma.user.create({
        data: {
          email: ownerEmail,
          emailNormalized: ownerEmail,
          passwordHash: await hashPassword(ownerPassword),
          fullName: ownerName,
        },
      }));

    await prisma.membership.upsert({
      where: {
        businessId_userId: { businessId: business.id, userId: owner.id },
      },
      update: {},
      create: { businessId: business.id, userId: owner.id, role: "OWNER" },
    });
    console.log(`Propietario listo: ${owner.email}`);
  } else {
    console.log(
      "Sin usuario propietario: define SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD y SEED_OWNER_NAME en .env para crearlo.",
    );
  }

  // Usuario STAFF opcional para probar permisos de empleado. Se crea SIN
  // vincular a ningún empleado: un OWNER/ADMIN debe vincularlo desde
  // Configuración > Empleados y cuentas (hasta entonces no ve ninguna cita).
  const staffEmail = process.env.SEED_STAFF_EMAIL?.trim().toLowerCase();
  const staffPassword = process.env.SEED_STAFF_PASSWORD;
  const staffUserName = process.env.SEED_STAFF_NAME?.trim();

  if (staffEmail && staffPassword && staffUserName) {
    const staffUser =
      (await prisma.user.findUnique({
        where: { emailNormalized: staffEmail },
      })) ??
      (await prisma.user.create({
        data: {
          email: staffEmail,
          emailNormalized: staffEmail,
          passwordHash: await hashPassword(staffPassword),
          fullName: staffUserName,
        },
      }));

    await prisma.membership.upsert({
      where: {
        businessId_userId: { businessId: business.id, userId: staffUser.id },
      },
      update: {},
      create: { businessId: business.id, userId: staffUser.id, role: "STAFF" },
    });
    console.log(`Usuario STAFF listo (sin vincular): ${staffUser.email}`);
  }

  console.log("Datos de prueba listos:");
  console.log(`Negocio: ${business.name} (${business.id})`);
  console.log(`Servicio: ${service.name} (${service.id})`);
  console.log(`Empleado: ${staff.displayName} (${staff.id})`);
}

main()
  .catch((error) => {
    console.error("No se pudieron crear los datos de prueba:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
