# 9. Worker -> LLM Structured Output Contract

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

**Queue contract** (constants in `@barista/shared/jobs`):

- Queue `brew-analysis`, job name `analyze`, data `{ "brewLogId": "uuid" }`.
- Job ID `analyze-<brewLogId>`: this is what makes duplicate requests (§8)
  return the existing job.
- The backend adds jobs with 3 attempts and exponential backoff starting at
  5 s. Completed and failed jobs are removed from Redis. The result lives in
  `llm_analyses`, and failures are logged by the worker.

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
     espresso yield ÷ dose. It also includes `tdsPercent` (or `null`) and
     `extractionYieldPercent`, worked out as in §6 (`null` without TDS, or
     without a yield where one is needed). `methodKind` is `filter` or `espresso`. The
     recipe includes its brewer, its `style` (`{ name, brewsLike }` or `null`:
     the bar's name for it, and the built-in it brews like, pour over,
     immersion, hybrid, cold brew, standard, soup…, §5e; every brew also
     carries `recipeStyle`, so soup shots aren't compared with standard ones), kind, water,
     expected yield (the target for espresso), finish window
     (`expectedFinishMinSec`/`MaxSec`), first-drop window (espresso), flow
     unit, and its steps with type, label, duration, how each moves on, and
     their values (pour-to, temperature, pressure, flow).
2. It calls the LLM API using **Structured Outputs** (strict JSON schema mode).

**System Prompt:**

> "You are an expert specialty coffee roaster and barista. Analyze the provided
> extraction log and historical brews for this coffee bean, including roast
> level, roast age, dose, yield, total brew time, rating, and tasting notes. Suggest
> concrete parameter adjustments for the next brew. rating and tastingNotes
> describe the coffee tasted on its own; drinkRating and drinkTastingNotes
> describe the finished drink. Milk and syrup mask acidity and bitterness and
> add sweetness, so treat drink notes as weaker evidence of extraction than
> straight notes, and compare a brew mainly with earlier brews served the same
> way (each brew's drink says how). Judge a brew against its recipe's style
> (its name is the bar's own; brewsLike says how it brews, so a custom
> 'Inverted' style that brews like immersion is an immersion brew): a soup shot is a long, high-ratio espresso on purpose, a cold brew steeps
> cold for hours, and an immersion brew isn't a pour over. A stovetop brew
> (moka pot, ibrik) is a strong, short brew judged on its own terms, not as
> espresso; an 'other' method is described by its style and the notes. The bean's
> roastType says what the roaster roasted it for: an espresso roast brewed as
> filter (or the reverse) may need a different approach rather than small
> corrections. Decaf and blends often extract differently from single origins.
> The flavorProfile is the roaster's description of the cup to aim for, and a
> higher altitudeMasl usually means denser beans that take a finer grind or
> hotter water. For espresso, judge flow
> from the first drop time, shot time and ratio against the recipe's
> windows, and consider the machine's capabilities (pre-infusion, flow and
> pressure control) and the grinder's step size when explaining the change.
> Respond strictly matching the provided JSON schema."

**Strict JSON Schema** (sent as-is; no `$schema` key, which strict mode does
not need):

```json
{
  "type": "object",
  "properties": {
    "reasoning": {
      "type": "string",
      "description": "A concise 1-2 sentence diagnosis of extraction quality and why adjustments are needed."
    },
    "suggestedGrindDelta": {
      "type": "string",
      "enum": ["much_finer", "finer", "no_change", "coarser", "much_coarser"]
    },
    "suggestedTempDelta": {
      "type": "number",
      "description": "Suggested change in Celsius (e.g., -1.5, 0, 2.0)."
    }
  },
  "required": ["reasoning", "suggestedGrindDelta", "suggestedTempDelta"],
  "additionalProperties": false
}
```

3. Once parsed, the worker inserts the result into the `llm_analyses` table.
   - The response is validated again after parsing (strict mode should
     guarantee the shape, but the worker doesn't rely on it).
   - `suggestedTempDelta` is rounded to 1 decimal (the column is
     `DECIMAL(3,1)`) and must be between −10 and +10 °C. Anything outside that
     is treated as a bad response: the attempt fails and BullMQ retries it.
   - A refusal, an empty response, or invalid JSON also fails the attempt.
