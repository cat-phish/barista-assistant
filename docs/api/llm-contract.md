# 9. Worker -> LLM Structured Output Contract

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

**Queue contract** (constants in `@barista/shared/jobs`):

- Queue `brew-analysis`, job name `analyze`, data `{ "brewLogId": "uuid" }`,
  plus `"auto": true` for one queued by auto-analyze (§8; delayed, skipped
  when auto-analyze is off or the daily cap is reached).
- Job ID `analyze-<brewLogId>`: this is what makes duplicate requests (§8)
  return the existing job.
- The backend adds jobs with 3 attempts and exponential backoff starting at
  5 s. Completed and failed jobs are removed from Redis. The result lives in
  `llm_analyses`; failures are logged by the worker, and a final one is
  recorded on the brew (`analysis_requests.error`, shown as the brew log's
  `analysisError`, §6).

**Configuration (worker env):** `DATABASE_URL` + `DATABASE_PASSWORD`,
`REDIS_URL` + `REDIS_PASSWORD`, `OPENAI_API_KEY`, and `OPENAI_MODEL`
(required, no default, since valid model names change over time);
`OPENAI_VISION_MODEL` (optional) reads bean labels (§9c). Passwords
are kept out of the URLs; a URL that also contains a password is rejected.
Each secret can instead be given as `NAME_FILE` (a path, e.g. a Docker secret
under `/run/secrets`), but not both. `OPENAI_BASE_URL` is optional and points
the OpenAI SDK at a compatible server (used for testing). The backend follows
the same rules for its own `DATABASE_*`, `REDIS_*` and `JWT_SECRET`.

When the `/worker` service processes a job from the `brew-analysis` BullMQ
queue:

1. It queries the target `brew_log`, the associated `bean` and the `recipe`
   (with its steps). Only that brew is sent: earlier brews aren't, so the
   analysis is a diagnosis of this one brew.
   - If the brew log no longer exists (deleted after queueing), the job
     completes without calling the LLM.
   - The bean includes its `roastLevel` (or `null` if unknown), which
     matters for temperature advice, and its `detailedRoastLevel`,
     `roastType`, `blendType` (each `null` if unknown) and `decaf` (§4), plus
     `flavorProfile`, `originArea`, `country`, `region`, `altitudeMasl`,
     `roastWeightLossPercent` and `batchNumber` (a home-roast batch).
     Price, website, notes, rating, producer, purchase date and green
     supplier aren't sent.
   - The prompt includes the bean's **effective** roast age in days at brew
     time (`roastAgeDays`, excluding days frozen; see §4) and
     `daysFrozenBeforeBrew`, when the bean has a `roastDate`. "At brew time"
     is the brew's **local** date: its `timestamp` shifted by its
     `utcOffsetMinutes` (§6), else in the `BREW_TIMEZONE` zone, else UTC.
   - The brew includes its `grinder` (or `null`): name plus whatever details
     are recorded (adjustment, setting range, step size, burr type/size,
     power, variable speed and its RPM range), so the LLM knows which grinder
     a grind setting refers to and can talk in steps. It also has `grindRpm` (or
     `null`): the speed on a variable-speed grinder, part of the grind, and
     `beanWeightInGrams`, `groundWeightOutGrams` and
     `grinderRetentionGrams` (in − out, or `null` unless both were weighed).
   - **Cold styles** (§5e):
     - the brew has `steeping`, `steepTemp`, `dilutionRatio`,
       `dilutedWith`, and the window it aimed for (`steepMinHours` /
       `steepMaxHours`, `expectedFinishMinSec` / `expectedFinishMaxSec`,
       brew-logs.md §6), which may differ from the recipe's; the recipe has
       `steepMinHours`, `steepMaxHours`, `steepTemp`, `dilutionRatio` and
       `dilutionWith`;
     - a brew still steeping isn't analyzed (the job is skipped);
     - the prompt explains:
       - long cold brew (hours, fridge or room) vs Kyoto drip (slow drip) vs
         rapid cold (minutes);
       - judging strength as served, after dilution;
       - concentrate TDS (~2.5–5 %) vs the diluted cup (~1.2–1.6 %);
       - steep time and grind as the levers for long brews.
   - The brew includes its `water` (or `null`): the water profile's name and
     its figures (`tdsPpm`, `generalHardnessPpm`, `alkalinityPpm`, each
     mineral in mg/L, `ph`; `null` where not recorded; §3c), so the LLM can
     allow for hard or soft water.
   - The brew includes `prepTools`: the names of the prep tools used (§3d),
     in checklist order. `[]` means none were recorded (older brews, or none
     ticked), not necessarily that none were used.
   - The brew includes `problems`: the names of what went wrong while
     brewing (§6b), in list order. `[]` means none were recorded, not that
     nothing went wrong. The prompt treats them as the clearest clues for
     the next brew (a stalled bed or choked shot points coarser, channeling
     to prep, a mistake like an untared scale to repeating rather than
     adjusting).
   - The brew includes its `drink` (or `null`): name, `servingSize` (the size
     made, else the drink's default, e.g. `"12 fl oz"`, or `null`) and
     ingredients (name, type, amount scaled to that size such as
     `"3 pump"`, note). Instructions aren't sent: they're not about extraction.
   - The brew also includes how it was served,
     `drink` (`{ name, ingredientTypes }`, e.g. `["milk", "syrup"]`, or `null`
     for the coffee on its own), and both tastings: `rating` / `tastingNotes`
     for the coffee on its own, `drinkRating` / `drinkTastingNotes` for the
     finished drink. So a latte's "sweet, caramel" isn't read as a straight
     shot's.
   - Espresso brews include their `machine` (or `null`): the log's brewer's
     name and capabilities (pre-infusion, flow and pressure control).
   - The brew includes its `marks` (`{ kind, stepOrder, atSec }`): the first
     drop for espresso, and the real end of steps that waited for a tap or
     were logged, so the LLM sees e.g. that the bloom ran 52 s, not 45.
   - The brew includes its recipe's `methodKind` (or `null` without a
     recipe), `actualWaterGrams` (`null` for espresso), the measured
     `actualYieldGrams` (or `null`) and `brewRatio`: water ÷ dose, or for
     espresso yield ÷ dose. A **flash chilled** brew (brewed onto ice, §5)
     adds `actualIceGrams`, and its recipe `targetIceGrams`; `brewRatio`
     then counts the ice, (water + ice) ÷ dose, and the yield is weighed with
     the ice in. Such brews have no TDS. The prompt's `flashChilled` section
     tells the AI they're judged as served over ice. It also includes `tdsPercent` (or `null`) and
     `extractionYieldPercent`, worked out as in §6 (`null` without TDS, or
     without a yield where one is needed). `methodKind` is `filter`,
     `espresso`, `stovetop` or `other` (the brewer's kind, §3b). The
     recipe includes its brewer, its `style` (`{ name, brewsLike }` or `null`:
     the bar's name for it, and the built-in it brews like, pour over,
     immersion, hybrid, cold brew, standard, soup…, §5e; the brew also
     carries it as `recipeStyle`, so a soup shot isn't judged as a standard one), kind, water,
     expected yield (the target for espresso), finish window
     (`expectedFinishMinSec`/`MaxSec`), first-drop window (espresso), flow
     unit, and its steps with type, label, duration, how each moves on, and
     their values (pour-to, temperature, pressure, flow). With
     `stepTimeScaling` (recipes.md §5) the step durations and the finish
     window are the ones the brew was timed against, scaled to its water
     (`scaledToBrew`); pour targets stay the recipe's.
2. It turns that context into the **input** actually sent
   (`toLlmInput`, `worker/src/prompt.ts`), smaller than the context above:
   - **Empty values are dropped:** `null`, `""`, `[]` and `{}` keys are left
     out, so a missing key means "not recorded" (the prompt says so).
     `decaf` is only sent when true.
   - **Equipment by name:** the brew names its `grinder` and `water`; their
     details are in `equipment: { grinders: { <name>: details }, waters:
     { <name>: figures } }`.
   - The recipe's `flowUnit` is only sent when it isn't `g_s` (the default).
   - Shape: `{ ratingScale, bean, recipe, brew, drink, equipment }`.
3. It builds the **system prompt from sections** (`PROMPT_SECTIONS` in
   `worker/src/prompt.ts`), each included only when the input has what it's
   about, so a plain filter brew gets a short prompt. In order:

   | Section | Included when | What it says |
   | --- | --- | --- |
   | `core` | always | expert barista; judge this one brew against its recipe and the bean; missing = not recorded; equipment by name; change one or two levers |
   | `output` | always | what `reasoning`, `nextStep`, `confidence` and `suggestedRpmDelta` should hold; dose and shot weight null except for espresso |
   | `drink` | a drink or drink tasting is sent | drink notes are weaker evidence of extraction |
   | `style` | a recipe style is sent | judge against `brewsLike` (soup shot, immersion…) |
   | `stovetop` | a `stovetop` or `other` method | judged on its own terms |
   | `batch` | the bean has `batchNumber` | another batch is a different roast |
   | `roastType` | the bean has `roastType` | espresso roast as filter may need a different approach |
   | `decafBlend` | decaf or blend | extracts differently |
   | `flavorProfile` | the bean has one | the cup to aim for |
   | `weightLoss` | `roastWeightLossPercent` | how developed the roast is (11–13% light, 14–16% medium, 17%+ dark); more developed extracts more easily (coarser, cooler); trusted over the roast level |
   | `stepTimes` | the recipe has `stepTimeScaling` | step times and the finish window are already scaled to the batch; a bigger batch taking longer is planned, not a grind problem |
   | `altitude` | `altitudeMasl` | denser beans |
   | `origin` | origin area, country or region | context, not a rule |
   | `tds` | a brew has `tdsPercent` | judge strength and extraction from TDS and EY |
   | `water` | a water with figures | hardness and alkalinity effects |
   | `prepTools` | the brew lists prep tools | a tool not listed may still have been used |
   | `problems` | a brew lists problems | the clearest clues, explained first |
   | `rpm` | a brew has `grindRpm` | speed is part of the grind |
   | `retention` | a brew has `grinderRetentionGrams` | retention and stale grounds |
   | `espresso` | an `espresso` method | flow, windows, machine, step size; dose and shot weight as levers, one at a time |
   | `cold` | a style brews like `cold_brew`, `kyoto_drip` or `rapid_cold` | steep windows, dilution, concentrate TDS, levers |
   | `concentrate` | a brew or the recipe that isn't a cold style has a `dilutionRatio` | TDS and EY are the concentrate's; judge strength as served, over ice as an iced drink; dilution or ratio before grind |
   | `instructions` | the barista has their own instructions | `INSTRUCTIONS_INTRO` and their text |
   | `note` | a one-off note came with the request | `NOTE_INTRO` and the note |
   | `end` | always | respond strictly matching the schema |

   Each section's default text, label and lock live in
   `@barista/shared/aiPrompt` (`PROMPT_SECTION_TEXTS`); the `when` tests stay
   in the worker. **Whose prompt** (`docs/api/auth.md` §1c): an analysis uses
   the brew's barista's (`promptFor`, `worker/src/processor.ts`), with their
   overrides in place of unlocked sections' text and their `instructions`,
   then the request's `note`, before `end`. The locked sections (`output`,
   `suggestOutput`, `end`) are never replaced. A customized prompt's result
   is saved with `promptVersion` `PROMPT_VERSION + "+custom"`.

   Tests check which sections appear for given inputs and snapshot the
   assembled prompt for a fixed brew (`worker/tests/llm.test.ts`), so a
   wording change shows up in review.
4. It calls the LLM API using **Structured Outputs** (strict JSON schema
   mode): the system prompt, then the input as JSON.

**Strict JSON Schema** (`BREW_ANALYSIS_JSON_SCHEMA` in `worker/src/llm.ts`,
sent as-is; no `$schema` key, which strict mode does not need):

```json
{
  "type": "object",
  "properties": {
    "reasoning": {
      "type": "string",
      "description": "A concise 1-2 sentence diagnosis of extraction quality and why adjustments are needed."
    },
    "nextStep": {
      "type": "string",
      "description": "The one concrete thing to do on the next brew, in plain words (at most 140 characters)."
    },
    "confidence": {
      "type": "string",
      "enum": ["low", "medium", "high"],
      "description": "How sure the suggestion is: low with vague notes, no comparable brew, or measurements that look wrong."
    },
    "suggestedGrindDelta": {
      "type": "string",
      "enum": ["much_finer", "finer", "no_change", "coarser", "much_coarser"]
    },
    "suggestedTempDelta": {
      "type": "number",
      "description": "Suggested change in Celsius (e.g., -1.5, 0, 2.0)."
    },
    "suggestedRpmDelta": {
      "type": ["integer", "null"],
      "description": "Change in grinder speed (RPM) for a variable-speed grinder; null otherwise or to keep the speed."
    },
    "suggestedDoseDelta": {
      "type": ["number", "null"],
      "description": "Espresso only: change in dose in grams (e.g., 0.5, -1); null for other brews or to keep the dose."
    },
    "suggestedYieldDelta": {
      "type": ["number", "null"],
      "description": "Espresso only: change in shot weight (beverage out) in grams (e.g., 4, -3); null for other brews or to keep it."
    }
  },
  "required": ["reasoning", "nextStep", "confidence", "suggestedGrindDelta", "suggestedTempDelta", "suggestedRpmDelta", "suggestedDoseDelta", "suggestedYieldDelta"],
  "additionalProperties": false
}
```

5. Once parsed, the worker inserts the result into the `llm_analyses` table,
   with what was sent (`request`, `analysis.md` §8c), the `model` (`OPENAI_MODEL`) and `promptVersion` (`PROMPT_VERSION`
   in `worker/src/prompt.ts`, bumped whenever the input, prompt or schema
   changes) that made it, so analyses can be compared (`npm run eval -w
   worker`).
   - The response is validated again after parsing (strict mode should
     guarantee the shape, but the worker doesn't rely on it).
   - `suggestedTempDelta` is rounded to 1 decimal (the column is
     `DECIMAL(3,1)`) and must be between −10 and +10 °C. `nextStep` is at
     most 200 characters (the column), `suggestedRpmDelta` an integer within
     ±1000; `suggestedDoseDelta` (within ±5 g) and `suggestedYieldDelta`
     (within ±30 g) are rounded to 0.1 g. Anything outside that is treated
     as a bad response: the attempt fails and BullMQ retries it.
   - What doesn't apply is set to `null` (`onlyWhatApplies` in
     `worker/src/llm.ts`): `suggestedRpmDelta` unless the brew's grinder is
     variable-speed (and its speed isn't kept from the AI);
     `suggestedDoseDelta` and `suggestedYieldDelta` unless the brew is
     espresso, and either when it's 0.
   - The espresso section asks for one lever at a time: when the grind is
     right but the cup is too strong, weak, sour or bitter, a ratio change
     (dose or shot weight) rather than a grind change. Pre-infusion and
     profile changes aren't fields; when the machine allows them they go in
     `nextStep`.
   - A refusal, an empty response, or invalid JSON also fails the attempt.

## What the AI sees

A workspace's `aiHidden` setting (`docs/api/workspaces.md` §2, Settings →
**AI**, owners) lists details the worker leaves out of the input (step 2),
and the prompt sections about them drop out with them (step 3). Keys
(`AI_DETAILS`, `@barista/shared/aiDetails`):

- **The brew:** `tds` (`tdsPercent`, `extractionYieldPercent`), `temp` (the
  brew's, the recipe's and each step's temperature), `marks`, `prepTools`,
  `problems`, `grinderWeights` (beans in, grounds out, retention), `rpm`
  (`grindRpm` and the grinders' speed range; no `suggestedRpmDelta` either),
  `drink` (the drink, its ingredients, `drinkRating` /
  `drinkTastingNotes`), `water` (the water's name and figures),
  `waterMinerals` (the figures only; the name is still sent).
- **The bean:** `origin` (`originArea`, `country`, `region`), `altitude`,
  `process`, `flavorProfile`, `roastType`, `roastLevel` (with
  `detailedRoastLevel`), `weightLoss` (`roastWeightLossPercent`),
  `decafBlend` (`decaf`, `blendType`), `batchNumber`.
- **Recipe and equipment:** `recipeSteps` (with `stepTimeScaling`), `grindStartingPoints`,
  `grinderDetails` (everything but the grinder's name), `machine`.
- **History:** `unratedHistory` leaves earlier brews without a rating out
  of what "Suggest parameters" sends (an analysis sends no earlier brews);
  `analyzeUnrated` stops unrated brews being analyzed:
  `POST /analyze` is a `409` (§8), and a job already queued is skipped.

Always sent: the bean and roaster names, roast date and age, dose, water,
ice (flash chilled), yield, time, grind setting, ratio, rating and tasting notes, and the
recipe's targets.

**Keeping it in step:** every field the analysis context can send is
either always sent or belongs to one of these keys, and this list says
which. When a field is added to the context (`worker/src/context.ts`), or
removed, decide which it is and update, in the same change:

- `worker/tests/aiDetails.test.ts`: its `Record<keyof …>` maps classify
  each context field as `"always"` or an `AI_DETAILS` key, so the test
  typecheck fails until a new field is classified (or a removed one is
  dropped), and the tests check each switch really drops its fields;
- for a switchable field, `toLlmInput` (`worker/src/prompt.ts`) leaves it
  out when its key is hidden, and its prompt section's `when` stops
  matching;
- a new key: `AI_DETAILS` (`@barista/shared/aiDetails`) and its label and
  group in `frontend/src/lib/aiDetails.ts` (`aiDetails.test.ts` there
  checks the two lists match);
- this section: the key's line above, or the "Always sent" list.

## 9b. Suggest parameters

The `parameter-suggestion` queue (`analysis.md` §8b): job `suggest`, data
`{ "suggestionId": "uuid" }`, the row in `parameter_suggestions` saying what
for. Retried like an analysis; once every attempt fails the row is
`failed` with the same messages. A suggestion no longer `pending` (or
deleted with its bean) is skipped.

1. **Context** (`loadSuggestContext`, `worker/src/suggestContext.ts`): the
   batch (the row's `batch…` amounts, else the recipe's targets, with its
   ratio: `(water + ice) / dose`, or for espresso shot weight / dose), the
   bean (as in step 1 above) and its effective roast age **today**, the
   recipe (with steps, their times scaled to the batch when it has
   `stepTimeScaling`), the brewer (`name`, `kind`, and for an espresso
   machine its controls) and the grinder (its details); then up to
   `maxBrews` earlier brews from the `source`, newest first, without ones
   still steeping (and unrated ones when `unratedHistory` is hidden). Each
   is a brew as in step 1, with its own bean's roast age, plus `sameBag`
   (this exact bean), `sameBean` (this coffee, any bag: roaster and name),
   `sameRecipe`, `sameGrinder`, `bean` (another bag's or bean's details,
   `null` for this bag) and `analysis`, its latest analysis (`reasoning`, `nextStep`,
   `confidence`, the suggested changes and the barista's `helpful`), or
   `null`. Then `options`, for the kinds in `alternativesAsked` (at most
   `MAX_OPTIONS`, 30, of each): `recipes` (the workspace's active recipes on
   active brewers, not this one: name, brewer, method kind, style, dose,
   water, ice, yield, temperature), `brewers` (active ones with an active
   recipe, not this one: name, kind) and `beans` (other active beans with
   weight left: the bean as in step 1, its roast age today, `gramsLeft`).
   Each has a short `ref` (`r1`, `b1`, `n1`) the AI answers with; its id
   stays in the worker.
2. **Input** (`toSuggestInput`, compacted as in step 2): `{ ratingScale,
   source, batch, bean, roastAgeDays, daysFrozen, recipe, brewer, grinder, brews,
   equipment, options }` (`options` only when there are some); the grinder and each brew's grinder and water by name,
   described once in `equipment`. What the workspace keeps from the AI
   (`aiHidden`) is left out the same way, other beans' details too.
3. **Prompt** (`SUGGEST_SECTIONS`): its own opening and output sections,
   then the analysis's topic sections (drink … flashChilled), with
   `suggestEspresso` in place of `espresso` (no change fields here), the
   asker's `instructions` and `note` (step 3 above, `requestedBy`), and
   `end`:

   | Section | Included when | What it says |
   | --- | --- | --- |
   | `suggestCore` | always | values for a brew about to be made; what each source picks (bag: this exact bag; bean: every bag of the coffee); the batch is the barista's, never changed, and a different batch size drains differently (grind); `sameBag`/`sameBean`/`sameRecipe`/`sameGrinder`, and an earlier analysis judged by the brew after it; another bag of this coffee carries over, allowing for its roast age; another bean's brews show the recipe, brewer or grinder, not this bean; start from the recipe's targets |
   | `suggestOutput` | always | what each field holds; grind on the named grinder's dial from brews on it or its starting point, else null; a ratio for the batch, kept (or null) unless the brews show a strength problem |
   | `suggestEspresso` | the recipe or a brew is espresso | windows and ratio as targets; the ratio sets the shot weight for the batch's dose; pre-infusion and profile in `nextStep` |
   | `suggestAlternatives` | `options` are sent | what each kind of option is; at most one of each, only with a reason (style or ratio for the roast or flavor profile, a brewer or bean that suits better); `option` is its ref, `why` in plain words; empty when nothing stands out; the values stay for this setup |

4. **Schema** (`PARAMETER_SUGGESTION_JSON_SCHEMA`, `worker/src/llm.ts`,
   strict): `reasoning`, `nextStep`, `confidence` (low / medium / high),
   `grindSetting` (number or null), `grindRpm` (integer or null), `tempC`
   (number or null), `ratio` (number or null) and `alternatives` (an array
   of `{ kind, option, why }`, empty when none), all required.
   - Checked after parsing: the grind rounded to 0.01 and 0–10000, the
     temperature to 0.1 °C and 0–100, the ratio to 0.01 and above 0, the speed
     an integer 50–5000; anything else fails the attempt.
   - What doesn't apply is set to `null` (`onlySuggestionsThatApply`): the
     grind without a grinder or off its dial (`settingMin`–`settingMax`),
     the speed unless the grinder is variable speed (and `rpm` is sent),
     the temperature when `temp` is hidden, and a ratio outside what the
     method brews at (`RATIO_RANGE`: espresso 0.75–5, filter 2–25) or the
     batch's own. Alternatives keep only those naming an option sent, of
     its kind, the first of each kind, saved as `{ kind, id, name, why }`
     (`alternativesThatApply`).
5. The worker saves the values with `status: "done"`, `brewCount`, `model`,
   `promptVersion`, what was sent (`request`, `analysis.md` §8c) and
   `completedAt`.

**What the AI sees:** the fields above are classified in
`worker/tests/aiDetails.test.ts` like the analysis's (the `sameBag` / `sameBean` /
`sameRecipe` / `sameGrinder` flags, `source`, the `batch`, the roast age today, each
brew's `analysis` and the brewer's name and kind are always sent; an
espresso machine's controls go with `machine`). The options are always
sent but for a recipe's `targetTempC` (`temp`) and a bean's details, which
go with their keys as the bean's do.

## 9c. Reading a bean label

The `label-read` queue (`bean-label.md` §4d): job `read`, data
`{ "images": ["<base64 WebP>", ...], "processes": ["Washed", ...] }`, the
photos already re-encoded by the backend and the workspace's visible
process names. The job's **return value** is the answer (`LabelFields`,
`@barista/shared/jobs`); nothing is written to the database, and it isn't
retried. `worker/src/label.ts`:

1. **Request:** `OPENAI_VISION_MODEL` (optional; empty uses `OPENAI_MODEL`),
   which must take images. A fixed system prompt (`LABEL_PROMPT`: fill a
   field only with what's printed, `null` otherwise, never from general
   knowledge; a best-before date isn't a roast date; feet and altitude
   ranges to one figure in metres; 12 oz = 340 g) and one user message: a
   text part naming the processes to choose from, then one `image_url` part
   per photo (`data:image/webp;base64,…`, `detail: "high"`). It isn't part
   of "Your AI prompt" (the person's instructions are for judging brews, not
   reading labels), and Settings → AI's "What the AI sees" doesn't apply:
   only the photos and the process names are sent.
2. **Schema** (`labelJsonSchema`, strict): every field of `LabelFields`,
   each nullable; `processName` is an enum of the given processes (or only
   `null` when there are none), the roast, type and blend fields enums of
   their bean values (§4).
3. **Checking the answer** (`labelSchema`): each value on its own, so one
   bad value becomes `null` without losing the rest. Text is trimmed and
   held to the bean's lengths; `altitudeMasl` 1–9000; `bagWeightGrams`
   1–100000; `roastDate` a real date from 2000 to tomorrow; `website` an
   http(s) address with a dotted host (`https://` added when missing);
   `decaf` only `true` is kept; a `processName` not in the list is `null`,
   and a matched one clears `processText`. A refusal, an empty response or
   invalid JSON fails the job (the route answers `502`).

The workspace's `readLabels` setting (`workspaces.md` §2) turns the route
off; nothing is sent unless someone presses the button.

## Evaluating changes

`npm run eval -w worker` (run on the host from the repo root; it reads the
root `.env`, only reads the database, and writes to the git-ignored
`eval/`):

- `snapshot [--limit 12]` picks recent rated brews;
- `run --label <name> [--yes]` sends each through the input and prompt as
  the code has them now (real API calls; it shows the token estimate and
  asks first), saving the outputs and token counts;
- `run --label <name> --suggest [source]` asks "Suggest parameters"
  instead, as if setting up each picked brew (its bean, recipe, brewer and
  grinder, brews before it from `source`, default `beanRecipe`), so the
  values can be held against how the brew went;
- `compare <a> <b>` writes a side-by-side report of two runs.

Run it before and after changing the input, prompt or schema, and bump
`PROMPT_VERSION`.
