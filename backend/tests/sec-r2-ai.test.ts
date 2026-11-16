// Security audit round 2, AI findings (audit/findings/R2-ai.md). Fails today
// and passes once the finding is fixed.
import { describe, expect, it } from "vitest";
import { menuBeanList } from "../src/routes/publicMenu.js";

type MenuBean = Parameters<typeof menuBeanList>[0][number];

const bean = (id: string, producer: string): MenuBean => ({
  id,
  roasterName: "Roaster",
  beanName: "Coffee",
  batchNumber: "7",
  process: null,
  roastDate: null,
  roastLevel: null,
  detailedRoastLevel: null,
  roastType: null,
  blendType: null,
  decaf: null,
  flavorProfile: "berries",
  originArea: null,
  country: null,
  region: null,
  altitudeMasl: null,
  producer,
  varieties: null,
  species: null,
  freezes: [],
});

describe("SEC-93: a bean field the builder hides stays off the public menu", () => {
  it("doesn't publish a hidden field just because two batches differ only in it", () => {
    const out = menuBeanList([bean("a", "Finca Uno"), bean("b", "Finca Dos")], ["flavorProfile"], "each");
    expect(out).toHaveLength(2);
    for (const b of out) expect(b).not.toHaveProperty("producer");
  });
});
