"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/access";
import { createCompanySchema, type CreateCompanyData, type CreateCompanyInput } from "./schema";

export type CreateCompanyResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function normalizeWebsite(value: string) {
  if (!value) return null;
  const url = new URL(value);
  return url.toString();
}

function normalizeInstagram(value: string) {
  if (!value) return null;
  const clean = value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "");
  return clean.replace(/\/$/, "").toLowerCase() || null;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

function companyDedupeKey(input: CreateCompanyData) {
  if (input.website) {
    const host = new URL(input.website).hostname.replace(/^www\./, "").toLowerCase();
    return `web:${host}`;
  }
  const instagram = normalizeInstagram(input.instagram);
  if (instagram) return `ig:${instagram}`;
  const phone = normalizePhone(input.whatsapp);
  if (phone) return `wa:${phone}`;
  return `name:${input.displayName.trim().toLowerCase()}|${input.location.trim().toLowerCase()}`;
}

export async function createCompany(input: CreateCompanyInput): Promise<CreateCompanyResult> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = createCompanySchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Revise os campos destacados.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const dedupeKey = companyDedupeKey(data);
  const existing = await prisma.company.findUnique({ where: { dedupeKey }, select: { id: true } });

  if (existing) {
    return { ok: false, message: "Esta empresa já está cadastrada." };
  }

  try {
    const company = await prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          displayName: data.displayName,
          website: normalizeWebsite(data.website),
          instagram: normalizeInstagram(data.instagram),
          whatsapp: normalizePhone(data.whatsapp),
          email: data.email || null,
          location: data.location || null,
          industry: data.industry || null,
          source: "MANUAL",
          dedupeKey,
          prospect: { create: { stage: "DISCOVERED", ownerId: session.user.id } },
        },
      });

      await tx.domainEvent.create({
        data: {
          type: "company.discovered",
          aggregateType: "company",
          aggregateId: created.id,
          payload: { companyId: created.id, source: "MANUAL" },
          uniqueKey: `company.discovered:${created.id}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "company.create",
          entityType: "company",
          entityId: created.id,
          metadata: { source: "MANUAL" },
        },
      });

      return created;
    });

    return { ok: true, id: company.id };
  } catch (error) {
    console.error("company.create failed", { error, dedupeKey });
    return { ok: false, message: "Não foi possível cadastrar a empresa. Tente novamente." };
  }
}
