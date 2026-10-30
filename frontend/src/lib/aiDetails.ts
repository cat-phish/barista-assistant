// What a workspace can keep from the AI (Settings → AI,
// docs/api/llm-contract.md §9 "What the AI sees"). The keys match
// AI_DETAILS in @barista/shared/aiDetails (aiDetails.test.ts checks).
export type AiDetail =
  | 'tds' | 'temp' | 'marks' | 'prepTools' | 'problems' | 'grinderWeights' | 'rpm' | 'drink' | 'water' | 'waterMinerals'
  | 'origin' | 'altitude' | 'variety' | 'process' | 'flavorProfile' | 'roastType' | 'roastLevel' | 'weightLoss' | 'decafBlend' | 'batchNumber'
  | 'recipeSteps' | 'grindStartingPoints' | 'grinderDetails' | 'machine'
  | 'unratedHistory' | 'analyzeUnrated';

export const AI_GROUPS = { brew: 'The brew', bean: 'The bean', recipe: 'Recipe and equipment', history: 'History' } as const;
export type AiGroup = keyof typeof AI_GROUPS;

export interface AiDetailInfo {
  key: AiDetail;
  group: AiGroup;
  label: string;
  hint: string;
}

const d = (group: AiGroup, key: AiDetail, label: string, hint: string): AiDetailInfo => ({ key, group, label, hint });

export const AI_DETAIL_LIST: AiDetailInfo[] = [
  d('brew', 'tds', 'TDS and extraction', 'Refractometer readings, and the extraction worked out from them'),
  d('brew', 'temp', 'Water temperature', 'The brew’s, the recipe’s and each step’s'),
  d('brew', 'marks', 'Timer marks', 'First drop, when steps really ended, and steps held'),
  d('brew', 'prepTools', 'Prep checklist', 'WDT, puck screen, filter…'),
  d('brew', 'problems', 'Problems checklist', 'What went wrong while brewing'),
  d('brew', 'grinderWeights', 'Beans in / grounds out', 'And the grinder retention'),
  d('brew', 'rpm', 'Grinder speed', 'Off: no speed changes are suggested'),
  d('brew', 'drink', 'The drink', 'What it was made into, its ingredients, and the drink’s tasting'),
  d('brew', 'water', 'Water profile', 'Its name and figures'),
  d('brew', 'waterMinerals', 'Water figures only', 'Hardness, minerals, pH; the water’s name is still sent'),
  d('bean', 'origin', 'Origin', 'Area, country and region'),
  d('bean', 'altitude', 'Altitude', ''),
  d('bean', 'variety', 'Variety and species', 'Bourbon, SL28…; arabica, robusta…'),
  d('bean', 'process', 'Process', ''),
  d('bean', 'flavorProfile', 'Flavor profile', 'The roaster’s description'),
  d('bean', 'roastType', 'Roasted for', 'Filter, espresso or omni'),
  d('bean', 'roastLevel', 'Roast level', 'And the roast name'),
  d('bean', 'weightLoss', 'Roast weight loss', 'How developed the roast is'),
  d('bean', 'decafBlend', 'Decaf and blend', ''),
  d('bean', 'batchNumber', 'Batch number', 'Home-roast batches'),
  d('recipe', 'recipeSteps', 'Recipe steps', 'Pours, waits and their targets'),
  d('recipe', 'grindStartingPoints', 'Recipe grind starting points', ''),
  d('recipe', 'grinderDetails', 'Grinder details', 'Burrs, range, step size…; the grinder’s name is still sent'),
  d('recipe', 'machine', 'Espresso machine', 'Pre-infusion, flow and pressure control'),
  d('history', 'unratedHistory', 'Unrated earlier brews', 'Off: Suggest parameters only sends brews with a rating'),
  d('history', 'analyzeUnrated', 'Analyze unrated brews', 'Off: a brew needs a rating before it can be analyzed'),
];

export const aiDetailsFor = (group: AiGroup): AiDetailInfo[] => AI_DETAIL_LIST.filter((x) => x.group === group);
