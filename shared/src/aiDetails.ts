// What a workspace can keep from the AI (docs/api/llm-contract.md §9, "What
// the AI sees"): WorkspaceSettings.aiHidden lists these keys. The worker
// leaves hidden details out of the analysis input and its prompt. The
// frontend has the labels (lib/aiDetails.ts).
export const AI_DETAILS = [
  // The brew
  "tds", // TDS and extraction yield
  "temp", // water temperature (brew, recipe, steps)
  "marks", // timer marks (first drop, step ends)
  "prepTools",
  "problems",
  "grinderWeights", // beans in / grounds out, retention
  "rpm", // grinder speed
  "drink", // the drink it was for, its ingredients and the drink tasting
  "water", // the water profile, name and figures
  "waterMinerals", // only the figures (the name stays)
  // The bean
  "origin", // origin area, country, region
  "altitude",
  "process",
  "flavorProfile",
  "roastType",
  "roastLevel",
  "weightLoss", // roast weight loss
  "decafBlend", // decaf and single origin / blend
  "batchNumber",
  // Recipe and equipment
  "recipeSteps",
  "grindStartingPoints",
  "grinderDetails", // burrs, range, step size… (the name stays)
  "machine", // an espresso machine's controls
  // History
  "unratedHistory", // earlier brews without a rating, in what "Suggest parameters" sends
  "analyzeUnrated", // analyzing a brew that isn't rated yet
] as const;
export type AiDetail = (typeof AI_DETAILS)[number];
