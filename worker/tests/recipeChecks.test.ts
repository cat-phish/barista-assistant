import { recipeStepWarnings, stepsEnd, type CheckedRecipe, type CheckedStep } from "@barista/shared/recipeChecks";
import { describe, expect, it } from "vitest";

const step = (stepType: CheckedStep["stepType"], durationSec: number | null, targetWaterGrams: number | null = null): CheckedStep => ({ stepType, durationSec, targetWaterGrams });
const recipe = (water: number | null, min: number | null, max: number | null, steps: CheckedStep[]): CheckedRecipe => ({
  targetWaterGrams: water,
  expectedFinishMinSec: min,
  expectedFinishMaxSec: max,
  steps,
});

// The recipes brewed most, as saved (double blooms are deliberate).
const rampedBloom = recipe(300, 140, 170, [
  step("prep", null),
  step("bloom", 10, 60),
  step("wait", 20),
  step("bloom", 10, 120),
  step("wait", 20),
  step("pour", 10, 210),
  step("wait", 20),
  step("pour", 10, 300),
  step("wait", 40),
]);
const zuppaLunga = recipe(220, 80, 95, [step("pour", 24, 220), step("press", 10), step("press", 46)]);
const soup80 = recipe(80, 45, 60, [step("pour", 18, 80), step("press", 10), step("press", 17)]);
const espressoPreInfusion = recipe(null, 25, 35, [step("preinfusion", 8), step("soak", 10), step("flow", 17)]);

describe("recipeStepWarnings", () => {
  it("passes the recipes that are really brewed", () => {
    expect(recipeStepWarnings(rampedBloom, "filter")).toEqual([]);
    expect(recipeStepWarnings(zuppaLunga, "filter")).toEqual([]);
    expect(recipeStepWarnings(soup80, "filter")).toEqual([]);
    expect(recipeStepWarnings(espressoPreInfusion, "espresso")).toEqual([]);
  });

  it("catches steps that pour short of the recipe's water (Soup 100 ml, as saved)", () => {
    const soup100 = recipe(100, 50, 65, [step("pour", 18, 80), step("press", 10), step("press", 22)]);
    expect(recipeStepWarnings(soup100, "filter")).toEqual(["The steps pour to 80 g, but the recipe's water is 100 g."]);
    expect(recipeStepWarnings({ ...soup100, targetWaterGrams: 81.5 }, "filter")).toEqual([]); // within 2 g
  });

  it("catches unbrewable pours and steps that end outside the window", () => {
    // Pours a kettle can't make, and steps ending well before a 3:00-3:30 window.
    const rushed = recipe(300, 180, 210, [step("bloom", 10, 50), step("wait", 22), step("pour", 11, 200), step("wait", 22), step("pour", 11, 300), step("wait", 22)]);
    expect(recipeStepWarnings(rushed, "filter")).toEqual([
      "Step 3 pours 150 g in 11 s (13.6 g/s), faster than a kettle pours.",
      "The steps end at 1:38, well before the target finish (3:00–3:30).",
    ]);
    const slow = recipe(300, 140, 170, [step("bloom", 45, 50), step("pour", 200, 300)]);
    // 1.25 g/s is slow but a steady pour; the 4:05 end is what's wrong.
    expect(recipeStepWarnings(slow, "filter")).toEqual(["The steps end at 4:05, after the target finish (2:20–2:50)."]);
    expect(recipeStepWarnings(recipe(300, null, null, [step("pour", 400, 300)]), "filter")).toEqual(["Step 1 pours 300 g over 400 s (0.8 g/s), slower than a steady pour."]);
  });

  it("catches water that goes backwards", () => {
    const back = recipe(300, null, null, [step("bloom", 30, 60), step("pour", 30, 200), step("pour", 30, 150), step("pour", 30, 300)]);
    expect(recipeStepWarnings(back, "filter")).toEqual(["Step 3 goes back to 150 g after 200 g: water targets are scale weights, so they only rise."]);
  });

  it("checks an espresso recipe's steps against its shot window only", () => {
    expect(recipeStepWarnings({ ...espressoPreInfusion, steps: [step("preinfusion", 10), step("flow", 40)] }, "espresso")).toEqual([
      "The steps end at 0:50, after the target finish (0:25–0:35).",
    ]);
  });

  it("leaves out what it can't judge: open-ended steps, no window, prep, instant steps", () => {
    expect(stepsEnd([step("prep", 60), step("bloom", 30, 50), step("pour", null, 300)])).toBeNull();
    expect(stepsEnd([step("prep", 60), step("bloom", 30, 50)])).toBe(30);
    expect(stepsEnd([step("prep", 60)])).toBeNull();
    expect(recipeStepWarnings(recipe(300, 140, 170, [step("bloom", 30, 50), step("pour", null, 300)]), "filter")).toEqual([]);
    expect(recipeStepWarnings(recipe(300, null, null, [step("bloom", 0, 50), step("pour", 60, 300)]), "filter")).toEqual([]);
  });
});
