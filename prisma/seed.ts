import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole, type Prisma } from "@prisma/client";
import { initialLibraryState } from "../lib/demo-data";

const prisma = new PrismaClient();

async function seedUser(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
  memberId?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  await prisma.user.upsert({
    where: { email: input.email.toLowerCase() },
    update: {
      name: input.name,
      phone: input.phone,
      passwordHash,
      role: input.role,
      memberId: input.memberId,
      active: true,
    },
    create: {
      name: input.name,
      email: input.email.toLowerCase(),
      phone: input.phone,
      passwordHash,
      role: input.role,
      memberId: input.memberId,
    },
  });
}

async function main() {
  const managerEmail = process.env.BOOTSTRAP_MANAGER_EMAIL?.trim();
  const managerPassword = process.env.BOOTSTRAP_MANAGER_PASSWORD;

  if (!managerEmail || !managerPassword) {
    throw new Error(
      "Set BOOTSTRAP_MANAGER_EMAIL and BOOTSTRAP_MANAGER_PASSWORD before seeding.",
    );
  }
  if (managerPassword.length < 12) {
    throw new Error("The bootstrap manager password must be at least 12 characters.");
  }

  await prisma.librarySnapshot.upsert({
    where: { id: "primary" },
    update: {},
    create: {
      id: "primary",
      state: initialLibraryState as unknown as Prisma.InputJsonValue,
    },
  });

  await seedUser({
    name: "Library Manager",
    email: managerEmail,
    phone: "+970 2 000 0000",
    password: managerPassword,
    role: UserRole.Manager,
  });

  const demoPassword = process.env.DEMO_ACCOUNT_PASSWORD;
  if (demoPassword) {
    if (demoPassword.length < 12) {
      throw new Error("DEMO_ACCOUNT_PASSWORD must be at least 12 characters.");
    }
    await seedUser({
      name: "Noor Ahmad",
      email: "receptionist@shelfandsoul.local",
      phone: "+970 2 000 0001",
      password: demoPassword,
      role: UserRole.Receptionist,
    });
    await seedUser({
      name: "Rami Saleh",
      email: "warehouse@shelfandsoul.local",
      phone: "+970 2 000 0002",
      password: demoPassword,
      role: UserRole.Warehouseman,
    });
    const demoMember = initialLibraryState.members[0];
    if (!demoMember) throw new Error("The demo customer account has no member record.");
    await seedUser({
      name: demoMember.name,
      email: demoMember.email,
      phone: demoMember.phone,
      password: demoPassword,
      role: UserRole.Customer,
      memberId: demoMember.id,
    });
  }

  console.info(`Seeded manager account ${managerEmail.toLowerCase()}.`);
  if (demoPassword) {
    console.info(
      "Seeded demo accounts for receptionist@shelfandsoul.local, warehouse@shelfandsoul.local, and lina@example.com.",
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error("Database seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
