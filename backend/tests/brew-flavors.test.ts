import { describe, expect, it } from "vitest";
import { FLAVOR_KEYS, flavorLabel } from "@barista/shared/flavors";
import { newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const logs = `/api/workspaces/${ws.id}/brew-logs`;
  const bean = await newBean(owner, ws.id);
  return { owner, ws, logs, bean };
}

describe("the flavor wheel's keys (@barista/shared/flavors)", () => {
  it("are unique, each under a ring listed before it, at most three deep", () => {
    expect(new Set(FLAVOR_KEYS).size).toBe(FLAVOR_KEYS.length);
    const seen = new Set<string>();
    for (const key of FLAVOR_KEYS) {
      expect(key).toMatch(/^[a-z_]+(\.[a-z_]+){0,2}$/);
      const parent = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : null;
      if (parent) expect(seen.has(parent), key).toBe(true);
      seen.add(key);
    }
  });

  it("read for the AI with their place on the wheel", () => {
    expect(flavorLabel("fruity.berry.blueberry")).toBe("Blueberry (Fruity › Berry)");
    expect(flavorLabel("sour_fermented.sour")).toBe("Sour (Sour & fermented)");
    expect(flavorLabel("floral")).toBe("Floral");
  });
});

describe("brew logs with flavors (docs/api/brew-logs.md §6)", () => {
  it("record picks from any ring in wheel order, replace them on PATCH, clear with []", async () => {
    const { owner, ws, logs, bean } = await setup();
    const id = await newBrewLog(owner, ws.id, bean, { flavors: ["off.musty.earthy", "fruity.citrus.lemon", "sweet"] });
    const got = await owner.agent.get(`${logs}/${id}`);
    expect(got.body.brewLog.flavors).toEqual(["fruity.citrus.lemon", "sweet", "off.musty.earthy"]);
    expect((await owner.agent.get(logs)).body.brewLogs[0].flavors).toEqual(["fruity.citrus.lemon", "sweet", "off.musty.earthy"]);

    const replaced = await owner.agent.patch(`${logs}/${id}`).send({ flavors: ["nutty_cocoa.cocoa.dark_chocolate"] });
    expect(replaced.status).toBe(200);
    expect(replaced.body.brewLog.flavors).toEqual(["nutty_cocoa.cocoa.dark_chocolate"]);
    // Other edits leave them alone.
    expect((await owner.agent.patch(`${logs}/${id}`).send({ rating: 4 })).body.brewLog.flavors).toEqual(["nutty_cocoa.cocoa.dark_chocolate"]);
    expect((await owner.agent.patch(`${logs}/${id}`).send({ flavors: [] })).body.brewLog.flavors).toEqual([]);
  });

  it("start empty and reject unknown keys and duplicates", async () => {
    const { owner, logs, bean } = await setup();
    const plain = await owner.agent.post(logs).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 });
    expect(plain.body.brewLog.flavors).toEqual([]);
    const send = (flavors: unknown) => owner.agent.post(logs).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, flavors });
    for (const bad of [["fruity.banana"], ["Fruity"], ["sweet", "sweet"], "sweet"]) {
      const res = await send(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error).toMatch(/flavors/);
    }
  });
});
