import dotenv from "./apps/api/node_modules/dotenv/lib/main.js";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./apps/api/src/auth.js";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();

async function main() {
  const email = "villadajo25010@gmail.com";
  const emailNormalized = email.trim().toLowerCase();
  const fullName = "Jennifer Villabona";
  const password = process.env.TURNIA_OWNER_PASSWORD;

  if (!password) {
    throw new Error("No se recibió la contraseña.");
  }

  if (password.length < 12 || password.length > 1024) {
    throw new Error("La contraseña debe tener entre 12 y 1024 caracteres.");
  }

  const business = await prisma.business.findUnique({
    where: { slug: "turnia-demo" },
  });

  if (!business || !business.active) {
    throw new Error("Turnia Demo no existe o no está activo.");
  }

  const existingUser = await prisma.user.findUnique({
    where: { emailNormalized },
  });

  if (existingUser) {
    throw new Error("Ya existe una cuenta con ese correo. No se hicieron cambios.");
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        emailNormalized,
        passwordHash,
        fullName,
        active: true,
      },
    });

    await tx.membership.create({
      data: {
        userId: user.id,
        businessId: business.id,
        role: "OWNER",
      },
    });
  });

  console.log("Cuenta OWNER creada correctamente.");
  console.log("Nombre:", fullName);
  console.log("Correo:", email);
  console.log("Negocio:", business.name);
  console.log("Rol: OWNER");
}

main()
  .catch((error) => {
    console.error("No se pudo crear la cuenta:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
