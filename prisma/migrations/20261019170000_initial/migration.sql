CREATE TYPE "UserRole" AS ENUM ('Manager', 'Receptionist', 'Warehouseman', 'Customer');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'Customer',
    "memberId" TEXT,
    "permissions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibrarySnapshot" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibrarySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_memberId_key" ON "User"("memberId");
CREATE INDEX "User_role_active_idx" ON "User"("role", "active");
