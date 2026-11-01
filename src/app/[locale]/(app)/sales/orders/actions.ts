"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseMadAmount } from "@/lib/money/input";
import { getServiceContext } from "@/server/auth/service-context";
import {
  cancelOrder,
  confirmOrder,
  createDraftOrder,
  issueInvoice,
  OrderDomainError,
  recordPayment,
  shipOrder,
  updateDraftOrder,
} from "@/server/services/orders";

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
  if (error instanceof OrderDomainError) return error.code;
  if (error instanceof Error && error.message === "FORBIDDEN") return "FORBIDDEN";
  return "INTERNAL";
}

async function finishAction(locale: string, orderId: string, key: string, operation: (context: Awaited<ReturnType<typeof getServiceContext>>) => Promise<unknown>) {
  const path = `/${locale}/sales/orders/${orderId}`;
  try {
    const context = await getServiceContext();
    await operation(context);
    revalidatePath(`/${locale}/sales/orders`);
    revalidatePath(path);
    redirect(path);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    redirect(`${path}?error=${encodeURIComponent(actionError(error))}&retry=${encodeURIComponent(key)}`);
  }
}

export async function createOrderAction(formData: FormData) {
  const locale = actionLocale(formData);
  const key = uuidSchema.safeParse(field(formData, "idempotencyKey"));
  const customerId = uuidSchema.safeParse(field(formData, "customerId"));
  const warehouseId = uuidSchema.safeParse(field(formData, "warehouseId"));
  const productId = uuidSchema.safeParse(field(formData, "productId"));
  const quantity = z.coerce.number().int().positive().max(999).safeParse(field(formData, "quantity"));
  if (!key.success || !customerId.success || !warehouseId.success || !productId.success || !quantity.success) {
    redirect(`/${locale}/sales/orders?error=VALIDATION_ERROR`);
  }
  try {
    const context = await getServiceContext();
    const result = await createDraftOrder(context, {
      customerId: customerId.data,
      warehouseId: warehouseId.data,
      lines: [{ productId: productId.data, quantity: quantity.data }],
      idempotencyKey: key.data,
    });
    revalidatePath(`/${locale}/sales/orders`);
    redirect(`/${locale}/sales/orders/${result.resourceId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    redirect(`/${locale}/sales/orders?error=${encodeURIComponent(actionError(error))}`);
  }
}

export async function updateDraftOrderAction(formData: FormData) {
  const { locale, orderId, key } = parseMutationFields(formData);
  const customerId = uuidSchema.safeParse(field(formData, "customerId"));
  const warehouseId = uuidSchema.safeParse(field(formData, "warehouseId"));
  const productId = uuidSchema.safeParse(field(formData, "productId"));
  const quantity = z.coerce.number().int().positive().max(999).safeParse(field(formData, "quantity"));
  if (!customerId.success || !warehouseId.success || !productId.success || !quantity.success) {
    redirect(`/${locale}/sales/orders/${orderId}?error=VALIDATION_ERROR`);
  }
  const path = `/${locale}/sales/orders/${orderId}`;
  try {
    const context = await getServiceContext();
    await updateDraftOrder(context, {
      orderId,
      idempotencyKey: key,
      customerId: customerId.data,
      warehouseId: warehouseId.data,
      lines: [{ productId: productId.data, quantity: quantity.data }],
    });
    revalidatePath(path);
    revalidatePath(`/${locale}/sales/orders`);
    redirect(path);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    redirect(`${path}?error=${encodeURIComponent(actionError(error))}`);
  }
}

export async function confirmOrderAction(formData: FormData) {
  const { locale, orderId, key } = parseMutationFields(formData);
  await finishAction(locale, orderId, key, (context) => confirmOrder(context, { orderId, idempotencyKey: key }));
}

export async function shipOrderAction(formData: FormData) {
  const { locale, orderId, key } = parseMutationFields(formData);
  await finishAction(locale, orderId, key, (context) => shipOrder(context, { orderId, idempotencyKey: key }));
}

export async function issueInvoiceAction(formData: FormData) {
  const { locale, orderId, key } = parseMutationFields(formData);
  await finishAction(locale, orderId, key, (context) => issueInvoice(context, { orderId, idempotencyKey: key }));
}

export async function recordPaymentAction(formData: FormData) {
  const { locale, orderId, key } = parseMutationFields(formData);
  const amountMinor = parseMadAmount(field(formData, "amount"));
  const method = z.enum(["bank_transfer", "cash", "check", "other"]).safeParse(field(formData, "method"));
  if (amountMinor === null || !method.success) redirect(`/${locale}/sales/orders/${orderId}?error=VALIDATION_ERROR`);
  await finishAction(locale, orderId, key, (context) => recordPayment(context, {
    orderId,
    idempotencyKey: key,
    amountMinor,
    method: method.data,
  }));
}

export async function cancelOrderAction(formData: FormData) {
  const { locale, orderId, key } = parseMutationFields(formData);
  await finishAction(locale, orderId, key, (context) => cancelOrder(context, { orderId, idempotencyKey: key }));
}

function parseMutationFields(formData: FormData) {
  const locale = actionLocale(formData);
  const orderId = uuidSchema.safeParse(field(formData, "orderId"));
  const key = uuidSchema.safeParse(field(formData, "idempotencyKey"));
  if (!orderId.success || !key.success) redirect(`/${locale}/sales/orders?error=VALIDATION_ERROR`);
  return { locale, orderId: orderId.data, key: key.data };
}
