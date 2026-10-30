import { describe, expect, it } from "vitest";
import { DEFAULT_LEXICON, FLAVOR_KEYS, LEXICON_FORMAT, flavorLabel, parseLexicon } from "@barista/shared/flavors";
import { addMember, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}`;
  const logs = `${base}/brew-logs`;
  const bean = await newBean(owner, ws.id);
  return { owner, ws, base, logs, bean };
}

// A small wheel of our own (docs/custom-flavor-wheel.md).
const OURS = {
  format: LEXICON_FORMAT,
  version: 1,
  name: "  House wheel ",
  flavors: [
    { key: "bright", label: "Bright", color: "#E0A030" },
    { key: "bright.citrus", label: "Zesty" },
    { key: "bright.citrus.yuzu", label: "Yuzu", note: "ignored" },
    { key: "deep", label: "Deep" },
  ],
};

describe("the built-in wheel (@barista/shared/flavors)", () => {
  it("has unique keys, each under a ring listed before it, at most three deep", () => {
    expect(new Set(FLAVOR_KEYS).size).toBe(FLAVOR_KEYS.length);
    expect(parseLexicon(DEFAULT_LEXICON)).toEqual({ ok: true, lexicon: DEFAULT_LEXICON });
  });

  it("reads picks for the AI with their place on the wheel, or the saved label", () => {
    expect(flavorLabel(DEFAULT_LEXICON, { key: "fruity.berry.blueberry", label: "x" })).toBe("Blueberry (Fruity › Berry)");
    expect(flavorLabel(DEFAULT_LEXICON, { key: "sour_fermented.sour", label: "x" })).toBe("Sour (Sour & fermented)");
    expect(flavorLabel(DEFAULT_LEXICON, { key: "floral", label: "x" })).toBe("Floral");
    expect(flavorLabel(DEFAULT_LEXICON, { key: "gone.away", label: "Old label" })).toBe("Old label");
  });
});

describe("lexicon files (docs/custom-flavor-wheel.md)", () => {
  it("trims, lower-cases colours and drops fields it doesn't know", () => {
    const parsed = parseLexicon(OURS);
    expect(parsed).toEqual({
      ok: true,
      lexicon: {
        format: LEXICON_FORMAT,
        version: 1,
        name: "House wheel",
        flavors: [
          { key: "bright", label: "Bright", color: "#e0a030" },
          { key: "bright.citrus", label: "Zesty" },
          { key: "bright.citrus.yuzu", label: "Yuzu" },
          { key: "deep", label: "Deep" },
        ],
      },
    });
  });

  it("says what's wrong, and where", () => {
    const withFlavor = (i: number, f: Record<string, unknown>) => ({ ...OURS, flavors: OURS.flavors.map((x, j) => (j === i ? f : x)) });
    const cases: Array<[unknown, RegExp]> = [
      [{ ...OURS, format: "sca" }, /^format:/],
      [{ ...OURS, version: 2 }, /newer version/],
      [{ ...OURS, name: " " }, /^name:/],
      [{ ...OURS, flavors: [] }, /^flavors:/],
      [withFlavor(1, { key: "Bright.Citrus", label: "Zesty" }), /^flavors\[1\]\.key:/],
      [withFlavor(2, { key: "bright.citrus.yuzu.peel", label: "Peel" }), /^flavors\[2\]\.key:/],
      [withFlavor(3, { key: "bright", label: "Again" }), /flavors\[3\]\.key: "bright" is listed twice/],
      [withFlavor(1, { key: "sour.citrus", label: "Zesty" }), /flavors\[1\]\.key: "sour" must be listed before "sour\.citrus"/],
      [withFlavor(0, { key: "bright", label: "" }), /^flavors\[0\]\.label:/],
      [withFlavor(0, { key: "bright", label: "Bright", color: "orange" }), /^flavors\[0\]\.color:/],
      [{ ...OURS, flavors: Array.from({ length: 501 }, (_, i) => ({ key: `f${i}`, label: `F${i}` })) }, /at most 500/],
    ];
    for (const [file, error] of cases) {
      const parsed = parseLexicon(file);
      expect(parsed.ok, JSON.stringify(file).slice(0, 80)).toBe(false);
      if (!parsed.ok) expect(parsed.error).toMatch(error);
    }
  });
});

describe("a workspace's flavor wheel (docs/api/flavor-lexicon.md §2c)", () => {
  it("is the built-in one until an owner imports one; members read it; reset brings it back", async () => {
    const { owner, ws, base } = await setup();
    const barista = await newUser();
    const viewer = await newUser();
    await addMember(owner, ws.id, barista, "barista");
    await addMember(owner, ws.id, viewer, "viewer");

    const first = await viewer.agent.get(`${base}/flavor-lexicon`);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ lexicon: DEFAULT_LEXICON, custom: false, updatedAt: null });

    expect((await barista.agent.put(`${base}/flavor-lexicon`).send(OURS)).status).toBe(403);
    const bad = await owner.agent.put(`${base}/flavor-lexicon`).send({ ...OURS, flavors: [{ key: "a.b", label: "B" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/flavors\[0\]\.key/);

    const put = await owner.agent.put(`${base}/flavor-lexicon`).send(OURS);
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ custom: true, lexicon: { name: "House wheel", flavors: [{ key: "bright" }, { key: "bright.citrus" }, { key: "bright.citrus.yuzu" }, { key: "deep" }] } });
    expect(typeof put.body.updatedAt).toBe("string");
    expect((await viewer.agent.get(`${base}/flavor-lexicon`)).body.lexicon.name).toBe("House wheel");

    expect((await barista.agent.delete(`${base}/flavor-lexicon`)).status).toBe(403);
    const reset = await owner.agent.delete(`${base}/flavor-lexicon`);
    expect(reset.body).toEqual({ lexicon: DEFAULT_LEXICON, custom: false, updatedAt: null });

    const outsider = await newUser();
    expect((await outsider.agent.get(`${base}/flavor-lexicon`)).status).toBe(404);
  });

  it("decides what brews can pick; picks it no longer has keep their saved label", async () => {
    const { owner, ws, base, logs, bean } = await setup();
    const id = await newBrewLog(owner, ws.id, bean, { flavors: ["fruity.citrus.lemon", "sweet"] });
    expect((await owner.agent.put(`${base}/flavor-lexicon`).send({ ...OURS, flavors: [...OURS.flavors, { key: "sweet", label: "Sugary" }] })).status).toBe(200);

    // The new wheel's labels and order; a pick it doesn't have keeps its label, last.
    const got = await owner.agent.get(`${logs}/${id}`);
    expect(got.body.brewLog.flavors).toEqual([
      { key: "sweet", label: "Sugary" },
      { key: "fruity.citrus.lemon", label: "Lemon" },
    ]);

    // New brews pick from the new wheel only.
    const post = (flavors: string[]) => owner.agent.post(logs).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, flavors });
    const old = await post(["fruity.citrus.lemon"]);
    expect(old.status).toBe(400);
    expect(old.body.error).toMatch(/isn't on this workspace's flavor wheel/);
    expect((await post(["bright.citrus.yuzu", "deep"])).body.brewLog.flavors).toEqual([
      { key: "bright.citrus.yuzu", label: "Yuzu" },
      { key: "deep", label: "Deep" },
    ]);

    // Editing the old brew can keep its old pick and add new ones, but not other old keys.
    const kept = await owner.agent.patch(`${logs}/${id}`).send({ flavors: ["fruity.citrus.lemon", "bright"] });
    expect(kept.status).toBe(200);
    expect(kept.body.brewLog.flavors).toEqual([
      { key: "bright", label: "Bright" },
      { key: "fruity.citrus.lemon", label: "Lemon" },
    ]);
    const added = await owner.agent.patch(`${logs}/${id}`).send({ flavors: ["fruity.citrus.lime"], rating: 2 });
    expect(added.status).toBe(400);
    expect((await owner.agent.get(`${logs}/${id}`)).body.brewLog.rating).toBeNull(); // nothing written

    // Back to the built-in wheel: the old pick is on it again.
    await owner.agent.delete(`${base}/flavor-lexicon`);
    expect((await owner.agent.get(`${logs}/${id}`)).body.brewLog.flavors).toEqual([
      { key: "fruity.citrus.lemon", label: "Lemon" },
      { key: "bright", label: "Bright" },
    ]);
  });

  it("goes with a backup, checked on restore", async () => {
    const { owner, base, bean, ws } = await setup();
    await newBrewLog(owner, ws.id, bean, { flavors: ["fruity"] });
    expect((await owner.agent.get(`${base}/backup`)).body.workspace.flavorLexicon).toBeNull();
    await owner.agent.put(`${base}/flavor-lexicon`).send(OURS);
    const backup = (await owner.agent.get(`${base}/backup`)).body;
    expect(backup.workspace.flavorLexicon).toMatchObject({ name: "House wheel" });
    expect(backup.tables.brew_log_flavors).toEqual([expect.objectContaining({ flavorKey: "fruity", label: "Fruity" })]);

    const restored = await owner.agent.post("/api/workspaces/restore").send({ name: "Copy", slug: "lexicon-copy", backup });
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    const copy = `/api/workspaces/${restored.body.workspaceId}`;
    expect((await owner.agent.get(`${copy}/flavor-lexicon`)).body).toMatchObject({ custom: true, lexicon: { name: "House wheel" } });
    expect((await owner.agent.get(`${copy}/flavor-lexicon`)).body.lexicon.flavors).toHaveLength(OURS.flavors.length);
    expect((await owner.agent.get(`${copy}/brew-logs`)).body.brewLogs[0].flavors).toEqual([{ key: "fruity", label: "Fruity" }]);

    // A pick saved before labels were takes the built-in one's.
    const unlabelled = { ...backup, workspace: { ...backup.workspace, flavorLexicon: null }, tables: { ...backup.tables, brew_log_flavors: backup.tables.brew_log_flavors.map(({ label: _l, ...r }: Record<string, unknown>) => r) } };
    const older = await owner.agent.post("/api/workspaces/restore").send({ name: "Older", slug: "lexicon-older", backup: unlabelled });
    expect(older.status, JSON.stringify(older.body)).toBe(201);
    expect((await owner.agent.get(`/api/workspaces/${older.body.workspaceId}/flavor-lexicon`)).body.custom).toBe(false);

    const broken = await owner.agent.post("/api/workspaces/restore").send({ name: "Bad", slug: "lexicon-bad", backup: { ...backup, workspace: { ...backup.workspace, flavorLexicon: { ...OURS, flavors: [{ key: "x.y", label: "Y" }] } } } });
    expect(broken.status).toBe(400);
    expect(broken.body.error).toMatch(/^backup\.workspace\.flavorLexicon\.flavors\[0\]\.key/);
  });
});

describe("brew logs with flavors (docs/api/brew-logs.md §6)", () => {
  it("record picks from any ring in wheel order, replace them on PATCH, clear with []", async () => {
    const { owner, ws, logs, bean } = await setup();
    const id = await newBrewLog(owner, ws.id, bean, { flavors: ["off.musty.earthy", "fruity.citrus.lemon", "sweet"] });
    const expected = [
      { key: "fruity.citrus.lemon", label: "Lemon" },
      { key: "sweet", label: "Sweet" },
      { key: "off.musty.earthy", label: "Earthy" },
    ];
    expect((await owner.agent.get(`${logs}/${id}`)).body.brewLog.flavors).toEqual(expected);
    expect((await owner.agent.get(logs)).body.brewLogs[0].flavors).toEqual(expected);

    const replaced = await owner.agent.patch(`${logs}/${id}`).send({ flavors: ["nutty_cocoa.cocoa.dark_chocolate"] });
    expect(replaced.status).toBe(200);
    expect(replaced.body.brewLog.flavors).toEqual([{ key: "nutty_cocoa.cocoa.dark_chocolate", label: "Dark chocolate" }]);
    // Other edits leave them alone.
    expect((await owner.agent.patch(`${logs}/${id}`).send({ rating: 4 })).body.brewLog.flavors).toHaveLength(1);
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
