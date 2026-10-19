import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function getActiveUser() {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      memberId: true,
      permissions: true,
      active: true,
      authVersion: true,
    },
  });
  if (!user?.active || user.authVersion !== session.authVersion) return null;
  return user;
}
