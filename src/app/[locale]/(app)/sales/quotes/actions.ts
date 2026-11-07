"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServiceContext } from "@/server/auth/service-context";
import {
  acceptQuote,
  convertAcceptedQuoteToOrder,
  createDraftQuote,
  QuoteDomainError,
  rejectQuote,
  sendQuote,
  updateDraftQuote,
} from "@/server/services/quotes";

const locales = new Set(["en", "fr"]);
const uuidSchema = z.uuid();

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function actionLocale(formData: FormData) {
  const locale = field(formData, "locale");
  return locales.has(locale) ? locale : "en";
}

function actionError(error: unknown) {
  if (error instanceof QuoteDomainError) return error.code;
  if (error instanceof Error && error.message === "FORBIDDEN") return "FORBIDDEN";
  return "INTERNAL";
}

function parseActionKeys(formData: FormData) {
  const locale = actionLocale(formData);
  const quoteId = uuidSchema.safeParse(field(formData, "quoteId"));
  const idempotencyKey = uuidSchema.safeParse(field(formData, "idempotencyKey"));
  if (!quoteId.success || !idempotencyKey.success) redirect(`/${locale}/sales/quotes?error=VALIDATION_ERROR`);
  return { locale, quoteId: quoteId.data, idempotencyKey: idempotencyKey.data };
}

async function finishQuoteAction(
  locale: string,
  quoteId: string,
  idempotencyKey: string,
  operation: (context: Awaited<ReturnType<typeof getServiceContext>>) => Promise<unknown>,
) {
  const path = `/${locale}/sales/quotes/${quoteId}`;
  try {
    const context = await getServiceContext();
    await operation(context);
    revalidatePath(`/${locale}/sales/quotes`);
    revalidatePath(path);
    redirect(path);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    redirect(`${path}?error=${encodeURIComponent(actionError(error))}&retry=${encodeURIComponent(idempotencyKey)}`);
  }
}

function parseQuoteFields(formData: FormData) {
  const customerId = uuidSchema.safeParse(field(formData, "customerId"));
  const warehouseId = uuidSchema.safeParse(field(formData, "warehouseId"));
  const productId = uuidSchema.safeParse(field(formData, "productId"));
  const quantity = z.coerce.number().int().positive().max(999).safeParse(field(formData, "quantity"));
  const validUntil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(field(formData, "validUntil"));
  return { customerId, warehouseId, productId, quantity, validUntil };
}

export async function createQuoteAction(formData: FormData) {
  const locale = actionLocale(formData);
  const parsed = parseQuoteFields(formData);
  const idempotencyKey = uuidSchema.safeParse(field(formData, "idempotencyKey"));
  if (!parsed.customerId.success || !parsed.warehouseId.success || !parsed.productId.success || !idempotencyKey.success || !parsed.quantity.success || !parsed.validUntil.success) {
    redirect(`/${locale}/sales/quotes?error=VALIDATION_ERROR`);
  }
  try {
    const context = await getServiceContext();
    const result = await createDraftQuote(context, {
      customerId: parsed.customerId.data,
      warehouseId: parsed.warehouseId.data,
      lines: [{ productId: parsed.productId.data, quantity: parsed.quantity.data }],
      validUntil: parsed.validUntil.data,
      idempotencyKey: idempotencyKey.data,
    });
    revalidatePath(`/${locale}/sales/quotes`);
    redirect(`/${locale}/sales/quotes/${result.resourceId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    redirect(`/${locale}/sales/quotes?error=${encodeURIComponent(actionError(error))}`);
  }
}

export async function updateQuoteAction(formData: FormData) {
  const { locale, quoteId, idempotencyKey } = parseActionKeys(formData);
  const parsed = parseQuoteFields(formData);
  if (!parsed.customerId.success || !parsed.warehouseId.success || !parsed.productId.success || !parsed.quantity.success || !parsed.validUntil.success) {
    redirect(`/${locale}/sales/quotes/${quoteId}?error=VALIDATION_ERROR`);
  }
  await finishQuoteAction(locale, quoteId, idempotencyKey, (context) => updateDraftQuote(context, {
    quoteId,
    customerId: parsed.customerId.data,
    warehouseId: parsed.warehouseId.data,
    lines: [{ productId: parsed.productId.data, quantity: parsed.quantity.data }],
    validUntil: parsed.validUntil.data,
    idempotencyKey,
  }));
}

export async function sendQuoteAction(formData: FormData) {
  const { locale, quoteId, idempotencyKey } = parseActionKeys(formData);
  await finishQuoteAction(locale, quoteId, idempotencyKey, (context) => sendQuote(context, { quoteId, idempotencyKey }));
}

export async function acceptQuoteAction(formData: FormData) {
  const { locale, quoteId, idempotencyKey } = parseActionKeys(formData);
  await finishQuoteAction(locale, quoteId, idempotencyKey, (context) => acceptQuote(context, { quoteId, idempotencyKey }));
}

export async function rejectQuoteAction(formData: FormData) {
  const { locale, quoteId, idempotencyKey } = parseActionKeys(formData);
  await finishQuoteAction(locale, quoteId, idempotencyKey, (context) => rejectQuote(context, { quoteId, idempotencyKey }));
}

export async function convertQuoteAction(formData: FormData) {
  const { locale, quoteId, idempotencyKey } = parseActionKeys(formData);
  const quotePath = `/${locale}/sales/quotes/${quoteId}`;
  try {
    const context = await getServiceContext();
    const result = await convertAcceptedQuoteToOrder(context, { quoteId, idempotencyKey });
    revalidatePath(`/${locale}/sales/quotes`);
    revalidatePath(quotePath);
    revalidatePath(`/${locale}/sales/orders`);
    revalidatePath(`/${locale}/sales/orders/${result.resourceId}`);
    redirect(`/${locale}/sales/orders/${result.resourceId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    redirect(`${quotePath}?error=${encodeURIComponent(actionError(error))}&retry=${encodeURIComponent(idempotencyKey)}`);
  }
}
