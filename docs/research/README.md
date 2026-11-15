# Brewing research

What the AI suggestions and Insights are based on: findings from academic
and hobbyist coffee research, in our own words with their sources. Prompt
sections that use a finding cite the file here (`docs/research/<file>.md`).

## Files

| File | Topic |
|---|---|
| [cold-bloom-low-temp.md](cold-bloom-low-temp.md) | Cold or room-temperature blooms, low-temperature and hybrid brewing, temperature-staged recipes, slurry vs kettle temperature, brewer heat loss |
| [temperature-roast-solubility.md](temperature-roast-solubility.md) | How roast degree, density, process and age change the right temperature; temperature as a lever next to grind and contact time |
| [agitation-pour-structure.md](agitation-pour-structure.md) | Bloom ratio and time, pulses vs continuous pours, swirl/stir, flow rate, bed depth, drawdown |
| [grind-fines-burrs.md](grind-fines-burrs.md) | Particle distribution, fines and migration, RPM, burr geometry, grind and temperature together |
| [strength-water-rest.md](strength-water-rest.md) | The 2023 UC Davis/SCA brew control chart, ratio and strength, water chemistry, rest and degassing, freezing |

## Writing rules (the repo is public, AGPL-3.0)

- **Our own words.** Summarize findings; facts aren't copyrightable, wording
  is. A quote is at most one sentence, in quotation marks, with its source.
- **No copied abstracts, figures, tables or transcripts.** Link to them. Only
  CC-BY papers may be quoted at more length, with attribution; nothing from
  CC-BY-NC or -ND works.
- **Every claim has a source:** a DOI or URL, and for a video its title, date
  and timestamp.
- **Say how strong the evidence is**, and record disagreements between
  sources rather than smoothing them over.

## Entry format

Each topic file starts with a short summary (the five to ten points that
matter most for the app), then one entry per finding:

```markdown
### <Short finding title>

- **Finding:** what was found, in one to three sentences.
- **Evidence:** peer-reviewed | controlled hobbyist test | expert opinion,
  plus what was tested (n, method) when known.
- **Source:** author, title, venue, year, DOI/URL (video: timestamp).
- **Lever:** temperature | grind | bloom | agitation | ratio | time | water |
  rest; and when it applies (roast level, method, brewer).
- **For the app:** prompt rule | new suggestion output | Insight | none, with
  a line on how.
```

Files end with **Disagreements and open questions** and **Sources**.

## Baseline (2026-11-14, prompt 2026-11-a, local data)

What the AI gave before any research-based change, from the 37 stored
suggestions and 36 analyses on the local instance. Later prompt versions
should move these numbers.

- **Suggest parameters:** the temperature equals the recipe's in 22 of 37,
  and is within 1 °C in 24. Only 4 temperatures ever came back (89, 90, 92
  and 93 °C). The ratio was null (kept) in 34 of 37.
- **Analysis on 5-star brews (4):** 3 of 4 said to change the temperature,
  by 2.0 °C on average. Each was "raise it to the recipe's 93 °C" with the
  grind kept, so the brew was being pulled back to the recipe's number.
  4-star brews (26) got a temperature change in 10.

### Eval baseline (2026-11-14, prompt 2026-11-a, gpt-6-luna)

`eval/base.json` and `eval/base-sug.json`: the 20 latest rated brews of
the restored workspace (rated 3–5; 7 at 4.5 or 5), each run through
the analysis and Suggest parameters (source beanRecipe).

- **The analysis only ever pushes the temperature up.** 11 of 20 changed
  it, every time upwards (+1 to +4 °C), to about 92–93 °C. That includes
  a 5-star and two 4.5-star brews at 89 °C (+3 each), and brews whose
  recipe has no temperature at all. It's a fixed belief about the "right"
  temperature, not a response to the cup.
- **High ratings still get changes:** 3 of the 7 brews at 4.5–5 were told
  to change the temperature, and 2 the grind.
- **Suggest parameters mostly copies the last brew's temperature** (9 of
  the 13 where both were known; 2 went to the recipe's). Only four values
  came back (89, 92, 93, 94 °C; 92 in 13 of 20). **The ratio stayed
  unchanged (null) in 18 of 20.**
- So the anchoring the user sees is mostly the analysis's upward push,
  repeated each time, plus a Suggest that rarely moves anything but the
  temperature.

### Eval p2 (2026-11-14, prompt 2026-11-b.r1, gpt-6-luna)

`eval/p2.json` and `eval/p2-sug.json`: the same 20 brews, with the
research findings in the prompt (`@barista/shared/research`) and the
lever-order rewrite.

- **The upward temperature push is gone.** 1 of 20 analyses changed the
  temperature (−1 °C, a kettle trim), against 11 of 20, all upwards, before.
- **High ratings are kept.** All 7 brews at 4.5–5 were told to keep the
  recipe; one also got a gentler pour. Before, 3 got a temperature change
  and 2 a grind change.
- **Other levers now come up.** Of the 4-and-below brews, five changes
  were to the ratio (more water), one to a bloom wait, one to the first
  pour; grind changes fell from 5 to 2.
- **Suggest parameters hardly moved.** Temperatures 92 °C in 11 of 20
  (13 before), equal to the last brew's in 10 of 16 (11 before), ratio
  kept in 19 of 20 (18 before). The locked `suggestOutput` text still says
  to keep the ratio unless there's a strength problem, and the stored
  analyses it reads are the old ones. That's for the routes work
  (backlog item 17), which gives the ratio its own route.
- **Watch:** a 3.5-star brew was told to repeat unchanged; "keep a
  well-rated brew" shouldn't reach the middle ratings. Fixed in `r2`:
  `ownPattern` now says anything below 4.5 gets at least one change.

### Eval p3 and p4 (2026-11-14, prompt 2026-11-c, gpt-6-luna)

`eval/p3.json`: Suggest parameters with routes (backlog item 17, research
`r1`). `eval/p4.json`: the analysis with `ownPattern` tightened (`r2`).

- **Routes rarely branch:** 3 of 20 suggestions gave a second route, each
  moving the grind (two also the temperature); none moved the ratio. The
  main pick kept the ratio in all 20 and is 92 °C in 12. Most labels say
  "repeat the best brew"; `ownPattern` is cited in 12.
- **The 3.5-star brew now gets a change** (more water, 368 g), where p2
  said to repeat it unchanged. No analysis changed the temperature.
- **Top ratings:** of the 7 at 4.5–5, 4 were kept, 1 got a gentler shake
  and 2 more water (one a 5-star). p2 kept all 7, so the tighter wording
  may have nudged changes upward; watch it.

### Eval p5 (2026-11-14, prompt 2026-11-d.r2, gpt-6-luna)

`eval/p5.json`: Suggest parameters asked for 2–3 routes, whatever the
rating (the second moves a different lever; after a kept top brew, one
change worth exploring).

- **Every suggestion has 2 routes** (3 of 20 in p3). The second moves the
  ratio in 11, the grind in 11 and the temperature in 8, against the
  main pick.
- **The main pick moved the ratio in 6 of 20** (0 in p3), still 92 °C in 12.
- Second routes read as real experiments ("Lengthen ratio: more water may
  soften the high TDS"), citing `leverOrder`, `ownPattern`, `tasteNotTemp`.

## Synthesis

Drawn from the five topic files (94 findings, researched November 2026).
The tag after each rule names the file it comes from: **cold** =
cold-bloom-low-temp, **temp** = temperature-roast-solubility, **agit** =
agitation-pour-structure, **grind** = grind-fines-burrs, **str** =
strength-water-rest.

### What it means for the baseline

Today's prompt treats temperature as the main dial and the recipe's number
as its target. The research says both are wrong. In the normal hot range,
temperature is a small lever that mostly sets how fast coffee extracts. The
recipe's number is a kettle setting that only means something for that
brewer. Strength (ratio) and extraction (grind, flow, agitation) are what
drive flavour. The prompt is pointing the AI at the weakest lever.

### Rules worth teaching the AI, strongest evidence first

**Peer-reviewed, consistent across studies**

1. **Taste follows strength (TDS) and extraction (EY), not temperature.**
   At matched TDS and EY, 87, 90 and 93 °C drip brews tasted the same.
   Don't make a 1–3 °C change the main fix. (temp, cold, str)
2. **Sour can mean too strong.** Sourness rises with TDS and falls with EY.
   A sour cup with normal or high strength needs more water (a longer
   ratio), not a finer grind. Bitterness rises with both. (str)
3. **In immersion, ratio sets strength and EY stays near 21%.** Grind,
   temperature (80–99 °C) and roast barely move the end result, only the
   speed. For a Switch, Clever or French press, change the ratio and steep
   time first. (agit, str, temp)
4. **There's no universal ideal box.** Preferences split into clusters, so
   learn the person's own TDS/EY and rating pattern from their brews
   instead of steering everyone to 18–22%. (str)
5. **Kettle isn't slurry.** A pour-over slurry runs about 5–8 °C below the
   kettle, more in thin or plastic brewers. Compare temperatures only
   within one brewer. (cold, temp)
6. **Fines set flow and contact time.** A slow drawdown points to fines or
   late agitation as much as to the grind number. (grind, agit)
7. **Finer isn't always more extraction.** Espresso extraction peaks and
   then drops at the finest settings when the flow goes uneven. (grind)
8. **Cold beans and dark roasts grind finer at the same setting.** Allow
   for days frozen and roast level when giving a grind setting. (grind,
   temp)
9. **Bicarbonate (KH) matters more than hardness.** With high alkalinity,
   suspect the water for a flat, dull filter cup before the grind.
   Espresso tolerates far more alkalinity. (str)
10. **Degassing:** fresh beans hold lots of CO2 and bloom hard. Freezing
    slows aging about 12×, so effective age is the right number. (str,
    agit)

**Expert consensus with partial controlled support**

11. **Cooler water for darker roasts** is well supported for dark roasts
    (hot brings out bitter, burnt and smoky notes). **Hotter for light
    roasts** is consensus that hasn't been blind-tested at small steps.
    Use it as a starting band, then move it only for a taste reason:
    roasty or astringent means cooler, thin or sour on a light roast
    means hotter. (temp, cold)
12. **Roast weight loss is the best roast number**, but naturals lose 2–3%
    more than washed coffees at the same development. (temp)
13. **Agitation helps until it carries fines to the filter.** A stalled
    drawdown after heavy swirling or stirring calls for less agitation
    before a coarser grind. (agit)
14. **Bed depth:** a bigger dose drains slower by design. Don't read that
    as too fine. The current prompt already allows for batch size. (agit)
15. **Bloom about 2–3× the dose; bloom length is a flavour lever.** Longer
    gives more body and extraction, shorter more aroma. (agit)

**Expert opinion only: offer as experiments, label them as such**

16. **Cold or cool blooms** (about 50–62 °C, the "Samo bloom") and
    **hot-then-cool staging** (Kasuya's Devil recipe) have no controlled
    data. Suggest them as something to try, never as a fix. (cold)
17. **Kasuya 4:6:** a bigger first 40% gives more acidity, and the number
    of later pours sets strength. (agit)
18. **Pour count:** experts disagree (few big pours vs five small ones), so
    treat it as a lever with a direction, not a rule. (agit)
19. **Rest windows** vary from a day (dark) to weeks (light, air roasted)
    with no study behind them. Treat roast age as a modifier, not a rule.
    (str)

**Don't teach**
- Altitude, density or variety → brew temperature: no evidence found. The
  current `altitude` section ("hotter water") should go or be softened.
  (temp)
- Burr type, burr size and RPM as rules: weak, grinder-specific. Context
  only. (grind)
- "Magnesium extracts more": computational only, not confirmed by
  experiment. The current `water` section repeats it. (str)

### Open disagreements

- **Light-roast temperature:** Hoffmann and Gagné boil; Kasuya and Wonderstate
  stay around 90–93 °C; Hedrick's 2026 blind test preferred 90–93 °C.
- **Do darker roasts extract more?** Lindsey 2024 says less, Rao 2020 says
  more, Liang 2021 says the same at equilibrium. Porosity speeds them up;
  the total may not rise.
- **Does a more even grind extract more?** Higher in espresso with SSP
  burrs, lower with sieved filter grinds.
- **Frozen beans:** finer and narrower (Uman 2016) or more fines and faster
  shots (later reports). Which way to adjust is unresolved.
- **Pour count and pulse faults:** Rao blames pulses for sourness (heat
  loss), Hedrick for bitterness (more extraction, stalls).

### Candidate Insights

- **Your own brew control chart:** TDS against EY coloured by rating, with
  the 2023 preference clusters shown faintly. It tells a person which
  cluster they're in. (str)
- **Rating against water temperature, split by roast level and brewer.**
  Caveats: it's a kettle number per brewer, and cup temperature at tasting
  confounds it. (temp, cold)
- **Rating against ratio** next to rating against grind, to show which
  lever moved this person's ratings. (str, grind)
- **Drawdown time against rating per recipe,** with dose (bed depth)
  shown. (agit)
- **Rating against effective roast age per bean,** to find each coffee's
  rest window from real brews. (str)

### What this changes in the plan

- **Phase 2 prompt:**
  - Replace "start from the recipe's targets" with the lever order: ratio
    for strength; grind, flow and agitation for extraction; temperature as
    a trim chosen from roast and taste.
  - Add short knowledge sections built from rules 1–15.
  - Drop or soften `altitude` and the magnesium line in `water`.
- **Phase 3 outputs:** the evidence supports step temperatures (cold bloom,
  staging) only as labelled experiments. Bloom size and length, pour count
  and agitation are expert-backed levers worth a structured output.
- **Settings:** an "exploratory" setting is where rules 16–18 belong. Steady
  and balanced shouldn't offer them unasked.
