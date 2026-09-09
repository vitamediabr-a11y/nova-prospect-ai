import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const USER_ROLES = ["OWNER", "ADMIN", "MANAGER", "SALES", "VIEWER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(allowed: readonly UserRole[]) {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });

  if (!user || !allowed.includes(user.role as UserRole)) {
    throw new Error("Ação não autorizada para este usuário.");
  }

  return { session, role: user.role as UserRole };
}
