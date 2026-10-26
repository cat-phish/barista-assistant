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
(required, no default, since valid model names change over time). Passwords
are kept out of the URLs; a URL that also contains a password is rejected.
Each secret can instead be given as `NAME_FILE` (a path, e.g. a Docker secret
under `/run/secrets`), but not both. `OPENAI_BASE_URL` is optional and points
the OpenAI SDK at a compatible server (used for testing). The backend follows
the same rules for its own `DATABASE_*`, `REDIS_*` and `JWT_SECRET`.

When the `/worker` service processes a job from the `brew-analysis` BullMQ
queue:

1. It queries the target `brew_log`, the associated `bean`, the `recipe` (with
   its steps), and up to 5 previous `brew_logs` for that same `beanId`
   ("previous" = `timestamp` earlier than the target's, newest first).
   - If the brew log no longer exists (deleted after queueing), the job
     completes without calling the LLM.
   - The bean includes its `roastLevel` (or `null` if unknown), which
     matters for temperature advice, and its `detailedRoastLevel`,
     `roastType`, `blendType` (each `null` if unknown) and `decaf` (§4), plus
     `flavorProfile`, `originArea`, `country`, `region`, `altitudeMasl` and
     `batchNumber` (a home-roast batch; the brews sent are all of that
     batch, since previous brews are of the same bean record).
     Price, website, notes, rating, producer, purchase date and green
     supplier aren't sent.
   - The prompt includes the bean's **effective** roast age in days at brew
     time (`roastAgeDays`, excluding days frozen; see §4) and
     `daysFrozenBeforeBrew`, when the bean has a `roastDate`. "At brew time"
     is the brew's **local** date: its `timestamp` shifted by its
     `utcOffsetMinutes` (§6), else in the `BREW_TIMEZONE` zone, else UTC.
   - Each brew includes its `grinder` (or `null`): name plus whatever details
     are recorded (adjustment, setting range, step size, burr type/size,
     power, variable speed and its RPM range), so the LLM knows which grinder
     a grind setting refers to, doesn't compare settings across different
     grinders, and can talk in steps. Each brew also has `grindRpm` (or
     `null`): the speed on a variable-speed grinder, part of the grind, and
     `beanWeightInGrams`, `groundWeightOutGrams` and
     `grinderRetentionGrams` (in − out, or `null` unless both were weighed).
   - **Cold styles** (§5e):
     - each brew has `steeping`, `steepTemp`, `dilutionRatio`,
       `dilutedWith`, and the window it aimed for (`steepMinHours` /
       `steepMaxHours`, `expectedFinishMinSec` / `expectedFinishMaxSec`,
       brew-logs.md §6), which may differ from the recipe's; the recipe has
       `steepMinHours`, `steepMaxHours`, `steepTemp`, `dilutionRatio` and
       `dilutionWith`;
     - brews still steeping are left out of the history, and a steeping brew
       isn't analyzed (the job is skipped);
     - the prompt explains:
       - long cold brew (hours, fridge or room) vs Kyoto drip (slow drip) vs
         rapid cold (minutes);
       - judging strength as served, after dilution;
       - concentrate TDS (~2.5–5 %) vs the diluted cup (~1.2–1.6 %);
       - steep time and grind as the levers for long brews.
   - Each brew includes its `water` (or `null`): the water profile's name and
     its figures (`tdsPpm`, `generalHardnessPpm`, `alkalinityPpm`, each
     mineral in mg/L, `ph`; `null` where not recorded; §3c), so the LLM can
     allow for hard or soft water and doesn't compare brews across waters as
     if they were the same.
   - Each brew includes `prepTools`: the names of the prep tools used (§3d),
     in checklist order. `[]` means none were recorded (older brews, or none
     ticked), not necessarily that none were used.
   - Each brew includes `problems`: the names of what went wrong while
     brewing (§6b), in list order. `[]` means none were recorded, not that
     nothing went wrong. The prompt treats them as the clearest clues for
     the next brew (a stalled bed or choked shot points coarser, channeling
     to prep, a mistake like an untared scale to repeating rather than
     adjusting).
   - The brew includes its `drink` (or `null`): name, `servingSize` (the size
     made, else the drink's default, e.g. `"12 fl oz"`, or `null`) and
     ingredients (name, type, amount scaled to that size such as
     `"3 pump"`, note). Instructions aren't sent: they're not about extraction.
   - Every brew (the target and the previous ones) includes how it was served,
     `drink` (`{ name, ingredientTypes }`, e.g. `["milk", "syrup"]`, or `null`
     for the coffee on its own), and both tastings: `rating` / `tastingNotes`
     for the coffee on its own, `drinkRating` / `drinkTastingNotes` for the
     finished drink. So a latte's "sweet, caramel" isn't read as a straight
     shot's.
   - Espresso brews include their `machine` (or `null`): the log's brewer's
     name and capabilities (pre-infusion, flow and pressure control).
   - Each brew includes its `marks` (`{ kind, stepOrder, atSec }`): the first
     drop for espresso, and the real end of steps that waited for a tap or
     were logged, so the LLM sees e.g. that the bloom ran 52 s, not 45.
   - Each brew includes its recipe's `methodKind` (or `null` without a
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
     immersion, hybrid, cold brew, standard, soup…, §5e; every brew also
     carries `recipeStyle`, so soup shots aren't compared with standard ones), kind, water,
     expected yield (the target for espresso), finish window
     (`expectedFinishMinSec`/`MaxSec`), first-drop window (espresso), flow
     unit, and its steps with type, label, duration, how each moves on, and
     their values (pour-to, temperature, pressure, flow).
2. It turns that context into the **input** actually sent
   (`toLlmInput`, `worker/src/prompt.ts`), smaller than the context above:
   - **Empty values are dropped:** `null`, `""`, `[]` and `{}` keys are left
     out, so a missing key means "not recorded" (the prompt says so).
     `decaf` is only sent when true.
   - **Equipment once:** each brew names its `grinder` and `water`; their
     details are in `equipment: { grinders: { <name>: details }, waters:
     { <name>: figures } }`, each listed once.
   - **History:** each of `previousBrews` has `sameRecipe` (true when it used
     the brew's recipe), the fairest comparison.
   - The recipe's `flowUnit` is only sent when it isn't `g_s` (the default).
   - Shape: `{ ratingScale, bean, recipe, brew, drink, previousBrews,
     equipment }`.
3. It builds the **system prompt from sections** (`PROMPT_SECTIONS` in
   `worker/src/prompt.ts`), each included only when the input has what it's
   about, so a plain filter brew gets a short prompt. In order:

   | Section | Included when | What it says |
   | --- | --- | --- |
   | `core` | always | expert barista; judge the brew against its recipe and the earlier brews (`sameRecipe` fairest); missing = not recorded; equipment by name; change one or two levers |
   | `output` | always | what `reasoning`, `nextStep`, `confidence` and `suggestedRpmDelta` should hold; dose and shot weight null except for espresso |
   | `drink` | a drink or drink tasting is sent | drink notes are weaker evidence; compare like with like |
   | `style` | a recipe style is sent | judge against `brewsLike` (soup shot, immersion…) |
   | `stovetop` | a `stovetop` or `other` method | judged on its own terms |
   | `batch` | the bean has `batchNumber` | brews are all of that batch |
   | `roastType` | the bean has `roastType` | espresso roast as filter may need a different approach |
   | `decafBlend` | decaf or blend | extracts differently |
   | `flavorProfile` | the bean has one | the cup to aim for |
   | `altitude` | `altitudeMasl` | denser beans |
   | `origin` | origin area, country or region | context, not a rule |
   | `tds` | a brew has `tdsPercent` | judge strength and extraction from TDS and EY |
   | `water` | a water with figures | hardness and alkalinity effects |
   | `prepTools` | a brew lists prep tools | compare only brews that list them |
   | `problems` | a brew lists problems | the clearest clues, explained first |
   | `rpm` | a brew has `grindRpm` | speed is part of the grind |
   | `retention` | a brew has `grinderRetentionGrams` | retention and stale grounds |
   | `espresso` | an `espresso` method | flow, windows, machine, step size; dose and shot weight as levers, one at a time |
   | `cold` | a style brews like `cold_brew`, `kyoto_drip` or `rapid_cold` | steep windows, dilution, concentrate TDS, levers |
   | `concentrate` | a brew or the recipe that isn't a cold style has a `dilutionRatio` | TDS and EY are the concentrate's; judge strength as served, over ice as an iced drink; dilution or ratio before grind |
   | `end` | always | respond strictly matching the schema |

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
   with the `model` (`OPENAI_MODEL`) and `promptVersion` (`PROMPT_VERSION`
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
  `detailedRoastLevel`), `decafBlend` (`decaf`, `blendType`),
  `batchNumber`.
- **Recipe and equipment:** `recipeSteps`, `grindStartingPoints`,
  `grinderDetails` (everything but the grinder's name), `machine`.
- **History:** `unratedHistory` leaves earlier brews without a rating out
  of `previousBrews`; `analyzeUnrated` stops unrated brews being analyzed:
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

## Evaluating changes

`npm run eval -w worker` (run on the host from the repo root; it reads the
root `.env`, only reads the database, and writes to the git-ignored
`eval/`):

- `snapshot [--limit 12]` picks recent rated brews;
- `run --label <name> [--yes]` sends each through the input and prompt as
  the code has them now (real API calls; it shows the token estimate and
  asks first), saving the outputs and token counts;
- `compare <a> <b>` writes a side-by-side report of two runs.

Run it before and after changing the input, prompt or schema, and bump
`PROMPT_VERSION`.
