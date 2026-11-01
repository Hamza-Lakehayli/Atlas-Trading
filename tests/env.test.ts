import { afterEach, describe, expect, it, vi } from "vitest";
import { getMigrationDatabaseUrl, getServerEnv } from "@/lib/env";
import { parseMadAmount } from "@/lib/money/input";

afterEach(() => vi.unstubAllEnvs());

describe("PostgreSQL database configuration", () => {
  it("accepts a native local PostgreSQL URL for migrations", () => {
    const url = "postgresql://fixture:fixture@127.0.0.1:5433/atlas_erp";
    vi.stubEnv("DATABASE_URL_UNPOOLED", url);
    expect(getMigrationDatabaseUrl()).toBe(url);
  });
  it("requires an explicitly configured direct database URL", () => {
    vi.stubEnv("DATABASE_URL_UNPOOLED", "");
    expect(() => getMigrationDatabaseUrl()).toThrow("Set DATABASE_URL_UNPOOLED");
  });

  it("rejects template credentials before attempting any connection", () => {
    vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://USER:PASSWORD@YOUR-ENDPOINT.REGION.aws.neon.tech/neondb?sslmode=require");
    expect(() => getMigrationDatabaseUrl()).toThrow("Set DATABASE_URL_UNPOOLED");
  });

  it("rejects using the pooled runtime endpoint for migrations", () => {
    vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://fixture:fixture@ep-test-pooler.example.invalid/db?sslmode=require");
    expect(() => getMigrationDatabaseUrl()).toThrow("direct database endpoint");
  });

  it("preserves SSL parameters on the direct URL", () => {
    const url = "postgresql://fixture:fixture@ep-test.example.invalid/db?sslmode=require";
    vi.stubEnv("DATABASE_URL_UNPOOLED", url);
    expect(getMigrationDatabaseUrl()).toBe(url);
  });

  it("does not enable demo mode implicitly", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture@database.invalid/db?sslmode=require");
    vi.stubEnv("BETTER_AUTH_SECRET", "unit-test-only-not-a-real-secret-000000");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("DEMO_PASSWORD", "unit-test-demo-password");
    vi.stubEnv("DEMO_MODE", undefined);
    expect(getServerEnv().DEMO_MODE).toBe("false");
  });
});

describe("MAD input parsing", () => {
  it("parses decimal amounts as exact integer minor units", () => {
    expect(parseMadAmount("3212.06")).toBe(321206);
    expect(parseMadAmount("3212,06")).toBe(321206);
    expect(parseMadAmount("18.5")).toBe(1850);
    expect(parseMadAmount("4")).toBe(400);
  });

  it("rejects zero, invalid precision, mixed separators, and oversized values", () => {
    for (const input of ["0", "-1", "1.001", "1,2.3", "1e4", "999999999.99", ""]) {
      expect(parseMadAmount(input)).toBeNull();
    }
  });
});
