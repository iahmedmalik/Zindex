import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asOwner, connect, denied, newId, urls } from "./helpers";

// The gap-free invoice number rule, checked straight against the database as the app's login role.

let owner: Client;
let app: Client;

beforeAll(async () => {
  owner = await connect(urls.owner());
  app = await connect(urls.app());
});
afterAll(async () => {
  await owner.end();
  await app.end();
});

async function seedStore(prefix = "SF"): Promise<{ ownerId: string; storeId: string }> {
  const ownerId = newId("owner");
  await owner.query(`insert into "user" (id, name, email) values ($1, $1, $2)`, [ownerId, `${ownerId}@test.local`]);
  const res = await owner.query<{ id: string }>("insert into stores (owner_id, name, invoice_prefix) values ($1, 'Test store', $2) returning id", [ownerId, prefix]);
  return { ownerId, storeId: res.rows[0]!.id };
}

const next = async (storeId: string) => (await app.query<{ n: string }>("select allocate_invoice_number($1) as n", [storeId])).rows[0]!.n;

describe("allocate_invoice_number", () => {
  it("counts 1, 2, 3 with the store's prefix", async () => {
    const { ownerId, storeId } = await seedStore("SF");
    await asOwner(app, ownerId, async () => {
      expect(await next(storeId)).toBe("SF-0001");
      expect(await next(storeId)).toBe("SF-0002");
      expect(await next(storeId)).toBe("SF-0003");
    });
  });

  it("hands the number back when the surrounding transaction rolls back (no gaps)", async () => {
    const { ownerId, storeId } = await seedStore("SP");
    // First transaction takes 0001 and is thrown away.
    await asOwner(app, ownerId, async () => {
      expect(await next(storeId)).toBe("SP-0001");
    });
    // The next real invoice still gets 0001.
    await app.query("begin");
    await app.query("select set_config('app.owner_id', $1, true)", [ownerId]);
    expect(await next(storeId)).toBe("SP-0001");
    await app.query("commit");
    await app.query("begin");
    await app.query("select set_config('app.owner_id', $1, true)", [ownerId]);
    expect(await next(storeId)).toBe("SP-0002");
    await app.query("commit");
  });

  it("counts each store on its own", async () => {
    const a = await seedStore("AA");
    const b = await seedStore("BB");
    await asOwner(app, a.ownerId, async () => {
      await next(a.storeId);
      expect(await next(a.storeId)).toBe("AA-0002");
    });
    await asOwner(app, b.ownerId, async () => {
      expect(await next(b.storeId)).toBe("BB-0001");
    });
  });

  it("refuses another owner's store and a signed-out caller", async () => {
    const a = await seedStore();
    const b = await seedStore();
    await asOwner(app, b.ownerId, async () => {
      await expect(next(a.storeId)).rejects.toThrow(/store not found/);
    });
    await asOwner(app, null, async () => {
      await expect(next(a.storeId)).rejects.toThrow(/store not found/);
    });
  });

  it("never lets the app role edit the counter directly", async () => {
    const { ownerId, storeId } = await seedStore();
    await asOwner(app, ownerId, async () => {
      expect(await denied(app.query("update stores set next_invoice_no = 1 where id = $1", [storeId]))).toBe(true);
    });
  });
});
