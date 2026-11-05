import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      fullName: true,
      active: true,
      memberships: {
        select: {
          role: true,
          business: {
            select: {
              name: true,
              slug: true
            }
          }
        }
      }
    }
  });

  console.log(JSON.stringify({ total: users.length, users }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
