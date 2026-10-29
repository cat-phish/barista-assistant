// The AI prompt's sections (docs/api/llm-contract.md §9, §9b and §9c) as text:
// the defaults, which prompt each belongs to, and which are locked (they
// describe the answer's JSON, so editing them could break it). The worker
// decides when each is included (worker/src/prompt.ts); a barista can
// replace an unlocked section's text and add instructions of their own
// (docs/api/auth.md §1c, "Your AI prompt").
export type PromptKind = "analysis" | "suggest" | "label";

export interface PromptSectionText {
  key: string;
  label: string; // for Settings → Your AI prompt
  prompts: readonly PromptKind[];
  locked: boolean;
  text: string;
}

export const PROMPT_SECTION_TEXTS: readonly PromptSectionText[] = [
  {
    key: "core",
    label: "What to do (analysis)",
    prompts: ["analysis"],
    locked: false,
    text:
      "You are an expert specialty coffee roaster and barista. Analyze this one brew (brew) against its recipe and the " +
      "bean, and suggest concrete changes for the next brew. A missing field means it wasn't recorded, not that it was " +
      "zero or absent. The brew's grinder and water are named in it and described in equipment. Ratings are 1-5; " +
      "rating and tastingNotes describe the coffee tasted on its own. Judge mainly from the tasting and how the brew " +
      "went against the recipe's targets, and change as little as needed: one or two levers at a time.",
  },
  {
    key: "output",
    label: "What each answer field holds (analysis)",
    prompts: ["analysis"],
    locked: true,
    text:
      "reasoning is a concise 1-2 sentence diagnosis. nextStep is the one concrete thing to do on the next brew, in " +
      "plain words a barista can act on (e.g. 'Grind 2 clicks coarser and keep 93 °C'). confidence is low when the " +
      "notes are vague, the brew has no recipe to judge it against, or the measurements look wrong; high only when " +
      "the taste and the numbers agree. suggestedRpmDelta is a change in grinder speed for a variable-speed grinder, " +
      "null otherwise or when the speed should stay. suggestedDoseDelta and suggestedYieldDelta are null except for " +
      "espresso.",
  },
  {
    key: "drink",
    label: "Drinks and their tasting",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "drinkRating and drinkTastingNotes describe the finished drink (the brew's drink says how it was served). Milk " +
      "and syrup mask acidity and bitterness and add sweetness, so treat drink notes as weaker evidence of extraction " +
      "than straight notes.",
  },
  {
    key: "style",
    label: "Recipe styles",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "Judge a brew against its recipe's style (its name is the bar's own; brewsLike says how it brews, so a custom " +
      "'Inverted' style that brews like immersion is an immersion brew): a soup shot is a long, high-ratio espresso " +
      "on purpose, and an immersion brew isn't a pour over.",
  },
  {
    key: "stovetop",
    label: "Stovetop brewers",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "A stovetop brew (moka pot, ibrik) is a strong, short brew judged on its own terms, not as espresso; an " +
      "'other' method is described by its style and the notes.",
  },
  {
    key: "batch",
    label: "Bean batch numbers",
    prompts: ["analysis", "suggest"],
    locked: false,
    text: "A batchNumber marks one home-roast batch: another batch of the same coffee is a different roast.",
  },
  {
    key: "roastType",
    label: "Roast type (filter, espresso, omni)",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "The bean's roastType says what the roaster roasted it for: an espresso roast brewed as filter (or the " +
      "reverse) may need a different approach rather than small corrections.",
  },
  {
    key: "decafBlend",
    label: "Decaf and blends",
    prompts: ["analysis", "suggest"],
    locked: false,
    text: "Decaf and blends often extract differently from single origins.",
  },
  {
    key: "flavorProfile",
    label: "The roaster's flavor notes",
    prompts: ["analysis", "suggest"],
    locked: false,
    text: "The flavorProfile is the roaster's description of the cup to aim for.",
  },
  {
    key: "weightLoss",
    label: "Roast weight loss",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "roastWeightLossPercent is the green weight lost in roasting, which measures how developed the roast is more " +
      "exactly than a roast name: around 11-13% is a light roast, 14-16% medium and 17% or more dark. A more developed " +
      "roast is more soluble and extracts more easily, so it takes a coarser grind or cooler water; a less developed " +
      "one needs more extraction. Trust it over the roast level when they disagree.",
  },
  {
    key: "stepTimes",
    label: "Step times that scale with the batch",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "The recipe has stepTimeScaling: its pour and wait step times scale with the batch, as time × (batch water ÷ " +
      "recipe water) to the power of stepTimeScaling, and its finish window moves by the time they gain or lose. The " +
      "steps and finish window given are already scaled to this batch, so a bigger batch taking longer is planned, " +
      "not a sign of a too-fine grind.",
  },
  {
    key: "altitude",
    label: "Growing altitude",
    prompts: ["analysis", "suggest"],
    locked: false,
    text: "A higher altitudeMasl usually means denser beans that take a finer grind or hotter water.",
  },
  {
    key: "origin",
    label: "Origin",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "The origin (originArea, country, region) hints at the bean's typical character, e.g. many East African " +
      "coffees are dense and bright while Brazilian ones are often lower grown and softer; treat it as context, " +
      "not a rule.",
  },
  {
    key: "tds",
    label: "TDS and extraction",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "When tdsPercent is given, use it and extractionYieldPercent to judge strength and extraction rather than " +
      "guessing from taste alone: filter usually lands around 1.15-1.45% TDS and espresso 8-12%, both often 18-22% " +
      "extraction, but the taste and the roaster's intent come first.",
  },
  {
    key: "water",
    label: "Water",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "A water's figures (mg/L; GH and KH as CaCO3) matter: harder water with more magnesium and calcium tends to " +
      "extract more, while high alkalinity (KH) buffers acidity and can flatten the cup; only the figures given are " +
      "known.",
  },
  {
    key: "prepTools",
    label: "Prep tools",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "prepTools lists the prep used (WDT, puck screen, filter type…), as recorded; a tool not listed may still " +
      "have been used.",
  },
  {
    key: "problems",
    label: "Brew problems",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "problems lists what went wrong while brewing (stalled drawdown, channeling, a gushing shot…): these are the " +
      "clearest clues for the next brew, so explain the change from them first (e.g. a stalled bed or a choked shot " +
      "points coarser, channeling to prep and distribution, a mistake like an untared scale to repeating rather than " +
      "adjusting).",
  },
  {
    key: "rpm",
    label: "Grinder speed (RPM)",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "On a variable-speed grinder, grindRpm is part of the grind: a higher speed usually grinds a little finer with " +
      "more fines, a lower one gives a clearer, more even cup; compare grind settings only at similar speeds.",
  },
  {
    key: "retention",
    label: "Grinder retention",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "grinderRetentionGrams is coffee left in the grinder (beans weighed in minus grounds out); actualDoseGrams is " +
      "what went into the brew. High or changing retention can explain inconsistent brews and stale grounds mixing in.",
  },
  {
    key: "espresso",
    label: "Espresso (analysis)",
    prompts: ["analysis"],
    locked: false,
    text:
      "For espresso, judge flow from the first drop time, shot time and ratio against the recipe's windows, and " +
      "consider the machine's capabilities (pre-infusion, flow and pressure control) and the grinder's step size when " +
      "explaining the change. Dose and shot weight are levers too: suggestedDoseDelta changes the dose in grams " +
      "(usually 0.5-1 g, within what the basket holds) and suggestedYieldDelta the shot weight in grams. A longer " +
      "shot (more yield) extracts more and tastes lighter, a shorter one is stronger and heavier; a bigger dose " +
      "slows the shot like a finer grind. Prefer one lever: when the grind is right but the cup is too strong, " +
      "weak, sour or bitter, change the ratio rather than the grind, and keep the others null or 0. A pre-infusion " +
      "or profile change, if the machine allows it, goes in nextStep.",
  },
  {
    key: "cold",
    label: "Cold brew",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "Cold styles (by brewsLike): cold_brew steeps for hours (the brew's steepMinHours-steepMaxHours, the window it " +
      "aimed for, which may differ from the recipe's; in the fridge or at room temperature per steepTemp; " +
      "actualTimeSec is the whole steep); kyoto_drip drips slowly over hours; rapid_cold (e.g. an OXO Rapid Brewer) " +
      "brews cold in minutes, aiming for the brew's expectedFinishMinSec-expectedFinishMaxSec (steepTemp, when set, " +
      "says if the water was fridge-cold or room temperature). Fridge steeps extract more slowly than " +
      "room-temperature ones. These are often concentrates served diluted 1 : dilutionRatio with dilutedWith (the " +
      "recipe's dilutionRatio is the intent): judge strength as served, after dilution. A concentrate's TDS is usually " +
      "around 2.5-5% and the diluted cup around 1.2-1.6%, so a high TDS isn't over-extraction by itself. For long cold " +
      "brews, steep time and grind are the main levers; temperature advice applies to rapid_cold only.",
  },
  {
    key: "concentrate",
    label: "Hot concentrates",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "Hot concentrates (a brew that isn't a cold style, with dilutionRatio; the recipe's is the intent) are brewed " +
      "strong and then served diluted 1 : dilutionRatio with dilutedWith, e.g. poured over ice. tdsPercent and " +
      "extractionYieldPercent are the concentrate's, measured before diluting, so a TDS of 2-5% isn't " +
      "over-extraction by itself; judge extraction from them and strength as served, after the dilution. Over ice " +
      "the cup is also chilled, so judge it as an iced drink. A cup that's too strong or weak as served but well " +
      "extracted needs a different dilution or brew ratio, not a grind change.",
  },
  {
    key: "flashChilled",
    label: "Flash chilled",
    prompts: ["analysis", "suggest"],
    locked: false,
    text:
      "Flash chilled brews (with actualIceGrams; the recipe's targetIceGrams is the intent) were brewed hot onto that " +
      "much ice in the server, e.g. Japanese iced pour over. actualWaterGrams is the hot water, which does the " +
      "extracting and which pour targets count; brewRatio counts the ice too, (water + ice) / dose, and " +
      "actualYieldGrams is weighed with the ice in. They take no TDS reading. Judge the cup as served over ice: it " +
      "should be brighter and more aromatic than cold brew, and a thin or watery cup can mean too much ice for the " +
      "hot water as well as under-extraction.",
  },
  {
    key: "end",
    label: "Answer in the JSON schema",
    prompts: ["analysis", "suggest", "label"],
    locked: true,
    text: "Respond strictly matching the provided JSON schema.",
  },
  {
    key: "suggestCore",
    label: "What to do (Suggest parameters)",
    prompts: ["suggest"],
    locked: false,
    text:
      "You are an expert specialty coffee roaster and barista. Suggest the starting values for a brew about to be made: " +
      "this bean (bean; roastAgeDays is its age today), this recipe (recipe), on the brewer and grinder named. brews " +
      "are earlier brews, newest first, chosen by source (bag: this exact bag's; bagRecipe: this bag's with this recipe; " +
      "bagBrewer: this bag's on this brewer; bean, beanRecipe, beanBrewer: the same for every bag of this coffee, " +
      "whatever its roast date or batch; brewer: this brewer's, any bean; recipe: this recipe's, any bean). Each says " +
      "whether it was sameBag, sameBean (this coffee, any bag), sameRecipe and sameGrinder, and carries the analysis " +
      "given after it, if any: a later brew shows whether that advice helped. Brews of this bag, recipe and grinder " +
      "are the strongest evidence. Another bag of this coffee (sameBean but not sameBag; its bean and roastAgeDays " +
      "say which) is the same coffee roasted another day: it carries over, allowing for its roast age and roast. " +
      "Another bean's brews show how the recipe, brewer or grinder tends to behave, not this bean. A missing field means it wasn't recorded, not that it was zero or absent. Grinders and waters are " +
      "described once in equipment and named where used. Ratings are 1-5; rating and tastingNotes describe the coffee " +
      "tasted on its own. batch is the amount about to be brewed, chosen by the barista for the cup size or the beans " +
      "left: never change it, even when it differs from the recipe's or earlier brews' amounts. Start from the " +
      "recipe's targets and move only where the brews give a reason. A pour over batch a quarter or more bigger or " +
      "smaller than the brews' drains slower or faster: allow for it with one small grind step at most, and not at all " +
      "for a smaller difference.",
  },
  {
    key: "suggestOutput",
    label: "What each answer field holds (Suggest parameters)",
    prompts: ["suggest"],
    locked: true,
    text:
      "reasoning is a concise 1-2 sentence explanation of the values. nextStep is the one thing to do or watch on this " +
      "brew, in plain words a barista can act on. confidence is low with no comparable brews, vague notes or " +
      "measurements that look wrong; high only when several comparable brews agree. grindSetting is a number on the " +
      "named grinder's dial, within its range, from brews on that grinder (sameGrinder) or the recipe's " +
      "grindStartingPoints for it; null when neither gives one or no grinder is named. grindRpm is for a variable-speed " +
      "grinder only, else null. tempC is the water temperature. ratio is the brew ratio to use with the batch, as " +
      "batch.ratio and brewRatio count it ((water + ice) / dose; for espresso shot weight / dose); the batch's amounts " +
      "follow from it. Keep batch.ratio (or return null) unless the brews show a strength problem, such as a weak or " +
      "strong cup or a TDS off target, that a ratio change fixes.",
  },
  {
    key: "suggestEspresso",
    label: "Espresso (Suggest parameters)",
    prompts: ["suggest"],
    locked: false,
    text:
      "For espresso, the recipe's first-drop and shot-time windows and its ratio are the targets: earlier shots that " +
      "ran fast or slow on this grinder show which way to move the grind, and ratio sets the shot weight for the " +
      "batch's dose, which the basket fixes (a longer shot extracts more and tastes lighter). Consider the machine's " +
      "capabilities; a " +
      "pre-infusion or profile change, if the machine allows it, goes in nextStep.",
  },
  {
    key: "suggestAlternatives",
    label: "Something else to try (Suggest parameters)",
    prompts: ["suggest"],
    locked: false,
    text:
      "options lists what else the barista could brew, by kind: recipes (another recipe for this bean), brewers " +
      "(another brewer, with its own recipes) and beans (another bean in stock for this recipe, with gramsLeft). In " +
      "alternatives, suggest at most one of each kind listed, and only when the brews or the details give a reason to " +
      "think it would suit better: a style or ratio that fits this bean's roast or flavorProfile, a brewer that " +
      "suits it, or a bean that suits this recipe better. option is its ref; why says why in plain words (at most " +
      "140 characters). Leave alternatives empty when nothing stands out. The values are still for this bean, recipe " +
      "and grinder.",
  },
  {
    key: "labelCore",
    label: "Reading a bean label",
    prompts: ["label"],
    locked: false,
    text:
      "You read the label of a bag of roasted coffee from photos (front, back, a card), to fill in a form about the coffee. " +
      "Fill a field only with what is printed or clearly shown; null when it isn't there or can't be read. Never guess or " +
      "fill from general knowledge. roasterName is the roaster's name; beanName the coffee's name (often the farm, region or " +
      "blend name), without the roaster. processName is one of the given processes when the printed process is one of them " +
      "(e.g. 'Natural' for 'Dry process'); otherwise null, with the process as printed in processText. country is in English " +
      "(e.g. 'Ethiopia'); region the area within it. altitudeMasl is in metres above sea level: a range gives its middle, " +
      "feet are converted. flavorProfile is the tasting notes as printed, comma-separated. roastDate is the date it was " +
      "roasted, as YYYY-MM-DD; a best-before or packed-on date is not a roast date. detailedRoastLevel is a named roast " +
      "(City, Full City…) when one is printed; roastLevel only when just light, medium-light, medium, medium-dark or dark " +
      "is. roastType is filter, espresso or omni when the bag says what it's roasted for. blendType is blend when it says " +
      "blend, single_origin when it names one origin as such. decaf is true only when it says decaf. bagWeightGrams is the " +
      "net weight in grams (12 oz = 340). batchNumber is a roast batch or lot number. website is the roaster's web address " +
      "with https://.",
  },
  {
    key: "labelWeb",
    label: "Looking a bean up on the web",
    prompts: ["label"],
    locked: false,
    text:
      "You look up one bag of roasted coffee on the web, given what its label says, to fill in details the label leaves " +
      "out. Look for the roaster's own page for this coffee first. Give a value only when a page you found states it for " +
      "this coffee (the same roaster and coffee, not another lot or a similar coffee), with url the address of that page; " +
      "null otherwise. Never guess or fill from general knowledge. Values follow the label's rules: processName is one of " +
      "the given processes when it fits, otherwise null with the process in processText; country in English; " +
      "altitudeMasl in metres (a range gives its middle); flavorProfile the roaster's tasting notes, comma-separated; " +
      "detailedRoastLevel a named roast, roastLevel only light to dark; bagWeightGrams the net weight in grams; website " +
      "the roaster's web address.",
  },
];

// Each section's default text by key.
export const PROMPT_TEXT: Readonly<Record<string, string>> = Object.fromEntries(PROMPT_SECTION_TEXTS.map((s) => [s.key, s.text]));
export const LOCKED_SECTIONS: readonly string[] = PROMPT_SECTION_TEXTS.filter((s) => s.locked).map((s) => s.key);

// A barista's own prompt (users.ai_prompt): instructions added to the
// analysis and suggest prompts, instructions of their own for reading bean
// labels (missing in prompts saved before it), and their text for any
// unlocked section, by key.
export interface AiPrompt {
  instructions: string | null;
  labelInstructions?: string | null;
  overrides: Record<string, string>;
}
export const EMPTY_AI_PROMPT: AiPrompt = { instructions: null, labelInstructions: null, overrides: {} };
export const AI_INSTRUCTIONS_MAX = 2000;
export const AI_SECTION_MAX = 4000;
export const AI_NOTE_MAX = 500; // a one-off note with one request

// How the barista's instructions and a note go into the prompt, just before
// the closing section (the worker adds them; the settings page shows this).
export const INSTRUCTIONS_INTRO = "The barista's own instructions; follow them unless they contradict the JSON schema:";
export const NOTE_INTRO = "For this request only, the barista adds:";
export const LABEL_INSTRUCTIONS_INTRO = "The person's own instructions for reading labels; follow them unless they contradict the JSON schema:";

// The sections only the label read uses: changing them isn't a custom
// analysis or suggestion.
const LABEL_ONLY = PROMPT_SECTION_TEXTS.filter((s) => s.prompts.length === 1 && s.prompts[0] === "label").map((s) => s.key);

// Whether a prompt differs from the defaults: then it's saved as
// PROMPT_VERSION + "+custom".
export function isCustomPrompt(prompt: AiPrompt, note: string | null = null): boolean {
  return !!prompt.instructions || Object.keys(prompt.overrides).some((key) => !LABEL_ONLY.includes(key)) || !!note;
}
