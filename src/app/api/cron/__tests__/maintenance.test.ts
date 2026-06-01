import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../maintenance/route";
import { processMaintenance } from "@/lib/jobs/processors";

vi.mock("@/lib/jobs/processors", () => ({
  processMaintenance: vi.fn().mockResolvedValue(undefined),
}));

const originalCronSecret = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-test-secret";
});

afterEach(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
});

describe("GET /api/cron/maintenance", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(new Request("http://localhost/api/cron/maintenance"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Cron auth not configured");
    expect(processMaintenance).not.toHaveBeenCalled();
  });

  it("returns 401 when authorization is missing or wrong", async () => {
    const response = await GET(new Request("http://localhost/api/cron/maintenance"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(processMaintenance).not.toHaveBeenCalled();
  });

  it("runs both maintenance jobs when authorized", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/maintenance", {
        headers: { authorization: "Bearer cron-test-secret" },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(processMaintenance).toHaveBeenCalledWith({ type: "expire-claims" });
    expect(processMaintenance).toHaveBeenCalledWith({ type: "expire-interviews" });
  });
});
