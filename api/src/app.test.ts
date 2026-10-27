import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("app without a database", () => {
  it("answers the health check", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("answers an unknown path with a plain 404", async () => {
    const res = await request(createApp()).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found." });
  });
});
