// Brewing research the AI suggestions build on (docs/research/README.md,
// "Synthesis"; docs/api/llm-contract.md §9, "Research findings"). Each
// finding is one rule in our own words, with the research file behind it.
// The worker sends a finding only when it applies to the brew (its scope and
// what it needs) and, for now, never an experiment: those wait for the
// research settings (docs/backlog.md item 21).
//
// RESEARCH_VERSION is stored inside each result's promptVersion
// ("2026-11-b.r1"), so results can be compared across research changes.
// Bump it whenever a finding is added, removed or reworded.
import type { PromptKind } from "./aiPrompt.js";

export const RESEARCH_VERSION = "r2";

export type ResearchLever = "ratio" | "grind" | "temperature" | "agitation" | "bloom" | "time" | "water" | "rest";
// peerReviewed: consistent across published studies; controlledTest: a
// controlled hobbyist test; expert: expert opinion or consensus only.
export type ResearchEvidence = "peerReviewed" | "controlledTest" | "expert";
// Which brews it's about: filter = hot filter of any style; pourOver also
// covers hybrid; immersion = steeped; espresso by method; any = all of them.
export type ResearchScope = "any" | "filter" | "pourOver" | "immersion" | "espresso";
// What the input must carry for the finding to be worth sending.
export type ResearchNeed = "water" | "roastAge" | "roastWeightLoss";

export interface ResearchFinding {
  key: string;
  title: string; // for Settings and the docs
  levers: readonly ResearchLever[];
  evidence: ResearchEvidence;
  scope: ResearchScope;
  needs?: ResearchNeed;
  experiment: boolean; // only as something to try, never as a fix
  prompts: readonly PromptKind[];
  source: string; // docs/research/<file>.md
  text: string;
}

const BOTH: readonly PromptKind[] = ["analysis", "suggest"];

export const RESEARCH_FINDINGS: readonly ResearchFinding[] = [
  {
    key: "leverOrder",
    title: "Which lever to move",
    levers: ["ratio", "grind", "agitation", "temperature"],
    evidence: "peerReviewed",
    scope: "any",
    experiment: false,
    prompts: BOTH,
    source: "strength-water-rest.md",
    text:
      "Pick levers in this order: the ratio for strength (weak or strong, thin or heavy); the grind, flow and " +
      "agitation for extraction (sour and hollow, or bitter and drying); the water temperature last, as a trim " +
      "chosen from the roast and the taste.",
  },
  {
    key: "tasteNotTemp",
    title: "Taste follows strength and extraction, not temperature",
    levers: ["temperature"],
    evidence: "peerReviewed",
    scope: "filter",
    experiment: false,
    prompts: BOTH,
    source: "temperature-roast-solubility.md",
    text:
      "In blind tests, filter brews made at 87, 90 and 93 °C tasted alike once their strength and extraction " +
      "matched: in the normal hot range, temperature mostly changes how fast coffee extracts. Don't make a 1-3 °C " +
      "change the main fix.",
  },
  {
    key: "sourStrong",
    title: "Sour can mean too strong",
    levers: ["ratio", "grind"],
    evidence: "peerReviewed",
    scope: "filter",
    experiment: false,
    prompts: BOTH,
    source: "strength-water-rest.md",
    text:
      "Sourness rises with strength and falls with extraction; bitterness rises with both. A sour cup that is also " +
      "strong, heavy or high in TDS wants a longer ratio (more water) before a finer grind; sour and thin or weak " +
      "is under-extracted: finer, longer contact or more agitation.",
  },
  {
    key: "immersionRatio",
    title: "In immersion, the ratio sets the cup",
    levers: ["ratio", "time"],
    evidence: "peerReviewed",
    scope: "immersion",
    experiment: false,
    prompts: BOTH,
    source: "agitation-pour-structure.md",
    text:
      "Steeped coffee settles near the same extraction (about 21%) whatever the grind, temperature (80-99 °C) or " +
      "roast; those mostly change how fast it gets there. Change the ratio and the steep time first; the grind " +
      "mainly changes the drawdown and the clarity.",
  },
  {
    key: "ownPattern",
    title: "No universal ideal",
    levers: ["ratio", "grind"],
    evidence: "peerReviewed",
    scope: "any",
    experiment: false,
    prompts: BOTH,
    source: "strength-water-rest.md",
    text:
      "Preferences differ: there's no single ideal strength and extraction. Go by this barista's own ratings (what " +
      "their best-rated brews had in common) rather than textbook targets. Only a brew rated 4.5 or more may be " +
      "kept unchanged, and only when its notes name no fault; anything rated below 4.5 gets at least one change, " +
      "the one most likely to help.",
  },
  {
    key: "kettleNotSlurry",
    title: "The kettle isn't the slurry",
    levers: ["temperature"],
    evidence: "peerReviewed",
    scope: "filter",
    experiment: false,
    prompts: BOTH,
    source: "cold-bloom-low-temp.md",
    text:
      "tempC is the kettle setting, not the coffee's: a pour over's slurry runs about 5-8 °C below it, more in thin " +
      "or plastic brewers. A temperature only means something for its own brewer, so don't carry one over from " +
      "another brewer, and don't pull a well-rated brew back to the recipe's number.",
  },
  {
    key: "roastTemp",
    title: "Roast sets the temperature band",
    levers: ["temperature"],
    evidence: "expert",
    scope: "filter",
    experiment: false,
    prompts: BOTH,
    source: "temperature-roast-solubility.md",
    text:
      "Darker roasts suit cooler water (hot brings out bitter, burnt and smoky notes); light roasts are usually " +
      "brewed hotter, though that's consensus rather than tested at small steps. Move the temperature from there " +
      "only for a taste reason: roasty, bitter or astringent means cooler; thin or sour on a light roast means hotter.",
  },
  {
    key: "finesFlow",
    title: "Fines and agitation set the drawdown",
    levers: ["grind", "agitation"],
    evidence: "expert",
    scope: "pourOver",
    experiment: false,
    prompts: BOTH,
    source: "grind-fines-burrs.md",
    text:
      "A slow drawdown points to fines or late, heavy agitation as much as to the grind number. Agitation helps " +
      "extraction until it carries fines into the filter: after heavy swirling or stirring, try less agitation " +
      "before a coarser grind.",
  },
  {
    key: "bloom",
    title: "Bloom size and length",
    levers: ["bloom"],
    evidence: "expert",
    scope: "pourOver",
    experiment: false,
    prompts: BOTH,
    source: "agitation-pour-structure.md",
    text:
      "Bloom with about 2-3 times the dose in water. Bloom length is a flavour lever: longer gives more body and " +
      "extraction, shorter keeps more aroma.",
  },
  {
    key: "espressoFinest",
    title: "Finer isn't always more extraction",
    levers: ["grind"],
    evidence: "peerReviewed",
    scope: "espresso",
    experiment: false,
    prompts: BOTH,
    source: "grind-fines-burrs.md",
    text:
      "At the finest settings an espresso's flow goes uneven and extraction drops again. A shot that is sour or " +
      "harsh and thin at an already fine setting, especially one that runs unevenly, may want better puck prep or " +
      "a slightly coarser grind, not a finer one.",
  },
  {
    key: "coldBeansFiner",
    title: "Frozen beans and dark roasts grind finer",
    levers: ["grind"],
    evidence: "peerReviewed",
    scope: "any",
    experiment: false,
    prompts: BOTH,
    source: "grind-fines-burrs.md",
    text:
      "Beans ground cold from the freezer, and darker roasts, come out finer at the same setting: allow for it when " +
      "carrying a grind setting over from another bag or roast.",
  },
  {
    key: "alkalinity",
    title: "Alkalinity matters more than hardness",
    levers: ["water"],
    evidence: "peerReviewed",
    scope: "any",
    needs: "water",
    experiment: false,
    prompts: BOTH,
    source: "strength-water-rest.md",
    text:
      "Of a water's figures, alkalinity (KH, bicarbonate) matters most, far more than hardness or pH: it " +
      "neutralizes the coffee's acids, so a high KH makes a filter cup flat and dull; suspect the water before the " +
      "grind. Espresso tolerates several times more.",
  },
  {
    key: "degassing",
    title: "Fresh beans and rest",
    levers: ["rest", "bloom"],
    evidence: "expert",
    scope: "any",
    needs: "roastAge",
    experiment: false,
    prompts: BOTH,
    source: "strength-water-rest.md",
    text:
      "Beans a few days off roast hold a lot of CO2: they bloom hard and can drain or extract unevenly, which a " +
      "longer bloom helps. How long a coffee wants to rest varies from about a day (dark) to weeks (light) with no " +
      "study behind it, so treat roast age as a modifier, not a rule.",
  },
  {
    key: "naturalsWeightLoss",
    title: "Naturals lose more weight",
    levers: ["temperature", "grind"],
    evidence: "expert",
    scope: "any",
    needs: "roastWeightLoss",
    experiment: false,
    prompts: BOTH,
    source: "temperature-roast-solubility.md",
    text:
      "Natural and other dried-in-the-fruit coffees lose about 2-3% more weight in roasting than washed ones at the " +
      "same development: read their roastWeightLossPercent a step lighter.",
  },
  {
    key: "coldBloom",
    title: "Cold or cool bloom",
    levers: ["bloom", "temperature"],
    evidence: "expert",
    scope: "pourOver",
    experiment: true,
    prompts: BOTH,
    source: "cold-bloom-low-temp.md",
    text:
      "As an experiment only (no controlled data): a cool bloom (about 50-62 °C) before hot pours, or hot first " +
      "pours then cooler ones, can soften harshness in a light roast.",
  },
  {
    key: "firstPours",
    title: "First pours and pour count",
    levers: ["agitation"],
    evidence: "expert",
    scope: "pourOver",
    experiment: true,
    prompts: BOTH,
    source: "agitation-pour-structure.md",
    text:
      "As an experiment only (experts disagree): a bigger share of the water in the first pours tends to bring " +
      "more acidity, and more later pours more strength; fewer, bigger pours or more, smaller ones are a lever to " +
      "try, not a rule.",
  },
];
