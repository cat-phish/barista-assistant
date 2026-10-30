import { describe, expect, it } from "vitest";
import { localBrewDate, parseTimeZone } from "../src/localDate.js";

const evening = new Date("2026-10-10T03:00:00Z"); // Oct 9, 8 pm in Los Angeles (PDT)

describe("localBrewDate", () => {
  it("uses the recorded offset first", () => {
    expect(localBrewDate(evening, -420, null)).toBe("2026-10-09");
    expect(localBrewDate(evening, -420, "Asia/Tokyo")).toBe("2026-10-09"); // the offset wins over the fallback
    expect(localBrewDate(new Date("2026-10-09T23:30:00Z"), 60, null)).toBe("2026-10-10"); // east of UTC: the next day
  });

  it("falls back to the configured zone, including its daylight saving", () => {
    expect(localBrewDate(evening, null, "America/Los_Angeles")).toBe("2026-10-09");
    expect(localBrewDate(new Date("2026-12-10T07:30:00Z"), null, "America/Los_Angeles")).toBe("2026-12-09"); // PST, UTC-8
  });

  it("is the UTC date without either", () => {
    expect(localBrewDate(evening, null, null)).toBe("2026-10-10");
  });
});

describe("parseTimeZone", () => {
  it("accepts IANA zones, treats empty as unset, and rejects anything else", () => {
    expect(parseTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(parseTimeZone(" ")).toBeNull();
    expect(parseTimeZone(undefined)).toBeNull();
    expect(() => parseTimeZone("Mars/Olympus")).toThrow(/not a valid time zone/);
  });
});
