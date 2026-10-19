import { describe, expect, it } from "vitest";
import { effectiveRoastAge } from "../src/roastAge.js";

// Same cases in worker/tests/roastAge.test.ts and frontend/src/lib/roastAge.test.ts.
describe("effectiveRoastAge", () => {
  const roast = "2026-10-01";
  it("is plain days since roasting when never frozen", () => {
    expect(effectiveRoastAge(roast, [], "2026-10-19")).toEqual({ ageDays: 18, daysFrozen: 0 });
  });
  it("stops counting while frozen", () => {
    const periods = [{ frozenOn: "2026-10-10", thawedOn: null }];
    expect(effectiveRoastAge(roast, periods, "2026-10-10")).toEqual({ ageDays: 9, daysFrozen: 0 });
    expect(effectiveRoastAge(roast, periods, "2026-12-25")).toEqual({ ageDays: 9, daysFrozen: 76 });
  });
  it("resumes after thawing", () => {
    const periods = [{ frozenOn: "2026-10-10", thawedOn: "2026-10-20" }];
    expect(effectiveRoastAge(roast, periods, "2026-10-25")).toEqual({ ageDays: 14, daysFrozen: 10 });
  });
  it("adds up several freezes", () => {
    const periods = [
      { frozenOn: "2026-10-03", thawedOn: "2026-10-05" },
      { frozenOn: "2026-10-10", thawedOn: null },
    ];
    expect(effectiveRoastAge(roast, periods, "2026-10-30")).toEqual({ ageDays: 7, daysFrozen: 22 });
  });
  it("gives past dates the age they had then (freezes after that date are ignored)", () => {
    const periods = [{ frozenOn: "2026-10-10", thawedOn: "2026-10-20" }];
    expect(effectiveRoastAge(roast, periods, "2026-10-08")).toEqual({ ageDays: 7, daysFrozen: 0 });
    expect(effectiveRoastAge(roast, periods, "2026-10-15")).toEqual({ ageDays: 9, daysFrozen: 5 });
  });
  it("ignores frozen time before the roast date and accepts ISO datetimes", () => {
    const periods = [{ frozenOn: "2026-09-20", thawedOn: "2026-10-05" }];
    expect(effectiveRoastAge("2026-10-01T00:00:00.000Z", periods, "2026-10-11")).toEqual({ ageDays: 6, daysFrozen: 4 });
  });
});
