import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [businesses, memberships, services, staff, sessions] =
    await Promise.all([
      prisma.business.count(),
      prisma.membership.count(),
      prisma.service.count(),
      prisma.staff.count(),
      prisma.session.count()
    ]);

  console.log(JSON.stringify({
    businesses,
    memberships,
    services,
    staff,
    sessions
  }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
