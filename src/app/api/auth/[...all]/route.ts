import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

function handlers() {
  return toNextJsHandler(getAuth());
}

export async function GET(request: Request) {
  return handlers().GET(request);
}

export async function POST(request: Request) {
  return handlers().POST(request);
}
