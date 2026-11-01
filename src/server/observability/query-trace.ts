import { AsyncLocalStorage } from "node:async_hooks";

export type QueryTrace = {
  id: string;
  name: string;
  source: string;
  permission: string;
  sqlTemplate: string;
  filters?: Record<string, string | number | boolean>;
  startedAt: number;
  durationMs?: number;
  rowCount?: number;
  status: "running" | "success" | "error";
};

type RequestTraceStore = { requestId: string; traces: QueryTrace[] };
const storage = new AsyncLocalStorage<RequestTraceStore>();

export function withRequestTrace<T>(operation: () => Promise<T>) {
  return storage.run({ requestId: crypto.randomUUID(), traces: [] }, operation);
}

export function getRequestTraces() {
  return storage.getStore()?.traces ?? [];
}

export async function withQueryTrace<T>(
  metadata: Omit<QueryTrace, "id" | "startedAt" | "status" | "durationMs" | "rowCount">,
  operation: () => Promise<T>,
): Promise<T> {
  const store = storage.getStore();
  const trace: QueryTrace = { ...metadata, id: crypto.randomUUID(), startedAt: performance.now(), status: "running" };
  store?.traces.push(trace);
  try {
    const result = await operation();
    trace.durationMs = Math.round((performance.now() - trace.startedAt) * 100) / 100;
    trace.rowCount = Array.isArray(result) ? result.length : undefined;
    trace.status = "success";
    return result;
  } catch (error) {
    trace.durationMs = Math.round((performance.now() - trace.startedAt) * 100) / 100;
    trace.status = "error";
    throw error;
  }
}
