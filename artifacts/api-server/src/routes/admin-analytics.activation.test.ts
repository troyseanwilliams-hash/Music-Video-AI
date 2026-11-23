import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute: mocks.execute } }));
import router from "./admin-analytics.js";

const handler = (router as any).stack.find((layer: any) =>
  layer.route?.path === "/admin/analytics/overview",
).route.stack[0].handle;

describe("First-creation admin checkpoints", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
    mocks.execute.mockReset();
    mocks.execute.mockImplementation(async query => {
      const sql = new PgDialect().sqlToQuery(query).sql;
      return {
        rows: sql.includes("AS confirmation_required")
          ? [{ signups: "12", confirmation_required: "10", confirmed: "8", chose_path: "7", chose_studio: "4", chose_video: "3", chose_images: "2", submitted: "5", saved_result: "4" }]
          : [],
      };
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  function response() {
    const res: any = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  }
  it("does not expose account activity to non-admins", async () => {
    const res = response();
    await handler({ isAuthenticated: () => false, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("returns numeric checkpoints from account and saved-result records", async () => {
    const res = response();
    await handler({ isAuthenticated: () => true, user: { email: "admin@example.test" }, query: { days: "30" } }, res);
    expect(res.json.mock.calls[0][0].firstCreation).toEqual({
      signups: 12, confirmationRequired: 10, confirmed: 8, chosePath: 7,
      choseStudio: 4, choseVideo: 3, choseImages: 2, submitted: 5, savedResult: 4,
    });
    const query = mocks.execute.mock.calls.map(([q]) => new PgDialect().sqlToQuery(q).sql)
      .find(q => q.includes("AS confirmation_required"))!;
    expect(query).toContain("email_verification_required");
    expect(query).toContain("interval '7 days'");
    expect(query).toContain("v.deleted_at IS NULL");
    expect(query).toContain("i.deleted_at IS NULL");
    expect(query).not.toContain("updated_at");
  });
});
