# Cold blooms, low-temperature and hybrid brewing

Cold or room-temperature blooms, low-temperature and "hybrid" brewing,
temperature-staged recipes, slurry vs kettle temperature, and brewer heat
loss. Written in our own words per the rules in [README.md](README.md).
Sources checked November 2026.

## Summary

1. **The kettle number is not the brew temperature.** In a hand pour-over
   the slurry runs well below the kettle: about 5-8 °C below in Hoffmann's
   guidance, peaking under 90 °C from a 96 °C kettle in Runnion's
   measurements, and about 15 °C below boiling in a preheated glass Chemex
   (Gagné). Insulated brewers, batch brewers and big pours lose less.
   `targetTempC` on a recipe step is a kettle setting, so two recipes with
   the same number on different brewers are not the same brew.
2. **Temperature is a moderate lever in the usual range.** When strength
   and extraction are matched, 87, 90 and 93 °C drip brews tasted the same
   to a trained panel (Batali 2020), and equilibrium extraction in immersion
   barely moves between 80 and 99 °C (Liang 2021). Within the normal hot
   range, temperature acts mostly through extraction speed, the same job
   grind and time do. A prompt should not reach for a 2-3 °C change as the
   main fix.
3. **Big temperature drops do change flavour, and how depends on roast.**
   At 4 or 22 °C instead of 92 °C, UC Davis panels found less bitter, sour
   and rubbery and more floral cups (Batali 2022). Dark roasts brewed hot
   gained bitter, burnt and smoky notes and lost sweetness. Light roasts
   lost less from cooler water but extracted far more slowly (Liang 2024).
4. **Cooler for darker roasts, hotter for lighter ones** is near-universal
   expert advice (Hoffmann, Kasuya, Gagné) but only partly tested. The
   controlled hot-vs-cold data support it for dark roasts. Nobody has
   tested it blind at small hot-range steps.
5. **Cold and cool blooms ("Samo bloom") are a practitioner technique
   without direct controlled evidence.** The usual rationale is that a
   cooler bloom keeps volatile aromatics. Smrke's peer-reviewed work
   supports the idea that evaporation after extraction costs aroma, but it
   didn't test blooms. Reports of a sweeter, more aromatic cup are
   anecdotal.
6. **Hot-then-cool staging** (Kasuya's Switch "Devil" recipe: 90 °C
   percolation, then 70 °C immersion) aims to take the early desirable
   compounds hot and slow the later, harsher ones. It's a well-known expert
   recipe with no measured data behind it.
7. **Small pours, an exposed bed and dispersion screens cost heat.** Keep
   water above the bed, use fewer and larger pours, and preheat (Gagné).
   Cooler slurry also raises water viscosity and can make flow less even.
8. **Serving temperature confounds ratings.** Taste changes as the cup
   cools, and low-temperature brews arrive cooler (Kasuya warns of this).
   Insights comparing ratings across temperatures should keep that in mind.

## Findings

### Slurry stays well below kettle temperature in pour-over

- **Finding:** In measurements by Colin Runnion, reported by Barista
  Hustle, a bloom-plus-one-pour brew with 96 °C water peaked below 90 °C,
  and the slurry was cooler still for most of the brew, in both plastic and
  ceramic brewers. A one-litre batch brew at 97 °C stayed above 90 °C for
  nearly five minutes, which the article puts down to insulation and brew
  size.
- **Evidence:** controlled hobbyist test (thermometer logging; n and exact
  setup not seen). The Barista Hustle page is paywalled, so this was read
  only through search-engine excerpts and is **partly verified**.
- **Source:** Barista Hustle, article on pour-over temperature citing Colin
  Runnion, https://www.baristahustle.com/?p=333089 (accessed via search
  excerpts, 2026).
- **Lever:** temperature; hand pour-over (V60-style) vs batch brewer.
- **For the app:** prompt rule. Treat `targetTempC` as a kettle setting.
  For small manual pour-overs, assume the effective slurry is roughly
  5-10 °C lower, and don't compare kettle numbers across brewer types as if
  they were brew temperatures.

### Hoffmann's kettle-vs-slurry guidance by roast

- **Finding:** Hoffmann recommends a boiling kettle for light roasts
  (aiming at about 93 °C slurry), 98 °C or more for medium (about 90 °C or
  more slurry), and about 90 °C for dark roasts (about 85 °C or more
  slurry). He calls this guidance, not a rule. The gap between kettle and
  slurry he assumes is about 5-8 °C.
- **Evidence:** expert opinion; the figures are from the video's
  description.
- **Source:** James Hoffmann, "Brew your coffee with boiling water - coffee
  brewing temperatures explained.", YouTube, 2020-03-03,
  https://www.youtube.com/watch?v=K_r5kpXPRYo (table in the description; no
  chapter timestamps; spoken content not checked).
- **Lever:** temperature; roast level; pour-over.
- **For the app:** prompt rule. A default anchor by roast (light: boiling,
  medium: 98 °C+, dark: ~90 °C), so the AI doesn't anchor on whatever the
  recipe already says. Insight: rating vs `targetTempC` split by roast
  level.

### Brewer material and preheating: how much the slurry cools

- **Finding:** Gagné measured slurry with a thermometer and found that a
  plastic V60 kept heat better than ceramic or glass, as Scott Rao also
  says. With boiling water, a thoroughly preheated glass Chemex ran at about
  85 °C slurry, and about 79-82 °C without preheating. Even fully preheated,
  he expects a V60 slurry to rarely pass about 93 °C. Pouring in many tiny
  batches, or letting the bed show, drops the temperature a lot. He found
  that a first pour of up to about 200 g of boiling water is enough to reach
  a stable slurry temperature, and that the bloom runs slightly cooler than
  later pours.
- **Evidence:** controlled hobbyist test (single-person thermometer
  readings, some figures from the author's comment replies, 2019); the flavour
  remark (cooler: less sweet, less bright) is his own and not blind-tested.
- **Source:** Jonathan Gagné, "How to Brew Better Coffee with a V60",
  Coffee ad Astra, 2018-11-30 (updated 2019),
  https://coffeeadastra.com/2018/11/30/brewing-better-coffee/ (section 4.6
  and comments of 2019-03-07 and 2019-06-06).
- **Lever:** temperature, agitation (pour structure); V60, Chemex; brewer
  material.
- **For the app:** prompt rule. When a sour/thin cup comes from a glass or
  ceramic brewer, many small pulses, or no preheat step, suggest preheating
  or fewer, larger pours before suggesting a higher kettle temperature. A
  missing preheat step in a recipe is worth a mention.

### An insulated brewer needs a cooler kettle for the same slurry

- **Finding:** To get the same average slurry of about 88 °C, Gagné needed
  a 99 °C kettle in a plastic V60 and a 94 °C kettle in the insulated Fellow
  Stagg [X], whose slurry was also a little warmer and steadier. Both cups
  hit the same 19.9% extraction, but the Stagg cup tasted sweeter and less
  ashy, which he puts down mostly to more even flow rather than heat.
- **Evidence:** controlled hobbyist test (temperature logger in 100 mL of
  water, then one brew each with matched TDS; single tester).
- **Source:** Jonathan Gagné, "Brewing with the Fellow Stagg [X] Dripper",
  Coffee ad Astra, 2020-12-09,
  https://coffeeadastra.com/2020/12/09/brewing-with-the-fellow-stagg-x-dripper/
- **Lever:** temperature; brewer (insulated vs plastic cone).
- **For the app:** prompt rule. The same kettle temperature means a
  different brew on different brewers (about 5 °C here). When a user copies
  a recipe to another brewer, the AI can note the kettle may need adjusting.

### Heat loss through dispersion screens and a drained bed

- **Finding:** Gagné notes that a dispersion cap (Pulsar) costs the stream
  a few degrees because droplets have much more surface area. He advises
  keeping about 1 cm of water above the bed to limit heat loss, using 99 °C
  rather than 100 °C for a steadier stream, and trying slightly cooler water
  for roasts darker than very light. In an earlier post he says that many
  small pours lower slurry temperature, which raises viscosity and makes
  flow less even, so a coarser grind may be needed.
- **Evidence:** expert opinion (physics-based reasoning, no measured
  figures in these posts).
- **Source:** Jonathan Gagné, "The Pulsar Dripper", Coffee ad Astra,
  2023-09-13, https://coffeeadastra.com/2023/09/13/the-pulsar-dripper/ ;
  "Extraction Uniformity and Channeling", Coffee ad Astra, 2019-10-04,
  https://coffeeadastra.com/2019/10/04/extraction-uniformity-and-channeling/
- **Lever:** temperature, agitation; drippers with shower screens, pulse
  pours.
- **For the app:** prompt rule. Count pulses and wait steps in a recipe as
  heat loss: a recipe with many short pours runs cooler than its
  `targetTempC` suggests.

### At matched strength and extraction, 87-93 °C drip brews taste the same

- **Finding:** UC Davis brewed one washed Honduran coffee on a programmable
  drip brewer at 87, 90 and 93 °C and adjusted grind, ratio and pulsing to
  hit nine strength/extraction targets at each temperature. A trained panel
  found no meaningful temperature effect, while strength and extraction
  changed the profile a lot. A consumer study with the same coffees likewise
  found strength and extraction drove liking.
- **Evidence:** peer-reviewed (trained panel of 12, 31 attributes, blind,
  triplicate; one coffee, one batch brewer, flat basket; set temperature,
  slurry not measured). Consumer arm: 118 consumers (Cotter et al. 2021).
- **Source:** Batali, Ristenpart, Guinard, "Brew temperature, at fixed brew
  strength and extraction, has little impact on the sensory profile of drip
  brew coffee", Scientific Reports 10:16450, 2020,
  https://doi.org/10.1038/s41598-020-73341-4 (CC BY); Cotter, Batali,
  Ristenpart, Guinard, "Consumer preferences for black coffee are spread
  over a wide range of brew strengths and extraction yields", Journal of
  Food Science, 2021, https://doi.org/10.1111/1750-3841.15561
- **Lever:** temperature (mainly through extraction); batch drip, one
  medium-type washed coffee.
- **For the app:** prompt rule. Within roughly 87-93 °C, temperature
  changes taste mainly by changing extraction, so it's interchangeable with
  grind or time. Prefer the lever that fits the rest of the recipe, and
  don't repeat "try 1-2 °C hotter" as the default. The authors note it
  didn't test other methods, roasts or species.

### Immersion equilibrium barely depends on temperature (80-99 °C)

- **Finding:** In UC Davis's equilibrium model for full immersion, the
  effective equilibrium constant (and so the final extraction yield, about
  21%) hardly changed with brew temperature between 80 and 99 °C, or with
  grind or roast. Temperature mainly changes how fast you get there.
- **Evidence:** peer-reviewed (lab immersion experiments plus a model).
- **Source:** Liang, Chan, Ristenpart, "An equilibrium desorption model for
  the strength and extraction yield of full immersion brewed coffee",
  Scientific Reports 11:6904, 2021,
  https://doi.org/10.1038/s41598-021-85787-1 (CC BY)
- **Lever:** temperature, time, ratio; full immersion (French press,
  Switch closed, AeroPress, cupping).
- **For the app:** prompt rule. For long immersion steps, a cooler
  `targetTempC` mostly slows extraction rather than capping it; a longer
  steep compensates. Sweeping temperature changes on immersion recipes are
  a weaker lever than ratio.

### Cold vs hot immersion at equal strength: less bitter, sour, rubbery; more floral

- **Finding:** Three coffees at three roasts (Agtron about 58, 48, 38) were
  brewed by full immersion to equilibrium at 4, 22 and 92 °C, diluted to the
  same 2% TDS and all served at 4 °C. Across every coffee and roast, hot
  brews were more bitter, sour and rubbery and cold brews more floral.
  Further effects depended on origin and roast: burnt was higher hot for
  medium roasts and the Ethiopian coffee, and fruity was higher cold for the
  Ethiopian. Hot brews had lower pH but mostly similar titratable acidity.
- **Evidence:** peer-reviewed (10 trained panellists, 27 attributes,
  remote tasting during COVID restrictions; 27 coffees in triplicate).
- **Source:** Batali, Lim, Liang, Yeager, Thompson, Han, Ristenpart,
  Guinard, "Sensory Analysis of Full Immersion Coffee: Cold Brew Is More
  Floral, and Less Bitter, Sour, and Rubbery Than Hot Brew", Foods
  11(16):2440, 2022, https://doi.org/10.3390/foods11162440 (CC BY)
- **Lever:** temperature (large range); full immersion; all roasts.
- **For the app:** prompt rule. When a user complains of bitterness or
  harshness, a much cooler step (or a cold bloom) is a legitimate direction
  rather than only a coarser grind, though at the cost of extraction speed.

### Roast decides what low temperature does

- **Finding:** Following light (Agtron about 72) and dark (about 42)
  roasts of one blend at 4, 22 and 92 °C over time, roast mattered most,
  then temperature, then time once strength plateaued. The dark roast
  brewed hot was more bitter, burnt, smoky, rubbery, astringent and earthy;
  the cold dark brews were sweeter and the 4 °C dark the most floral. The
  92 °C light roast was less sweet than the cold ones, while the 4 and 22 °C
  light brews didn't differ on bitter or burnt notes. Sour and citrus were
  higher hot for both roasts. The light roast extracted faster and reached
  higher strength at every time point, with the gap widest at 4 °C.
  Sweetness fell as strength rose.
- **Evidence:** peer-reviewed (14 trained panellists, 28 attributes, 30
  samples in triplicate; immersion).
- **Source:** Liang, Batali, Routt, Ristenpart, Guinard, "Sensory analysis
  of the flavor profile of full immersion hot, room temperature, and cold
  brewed coffee over time", Scientific Reports 14:19298, 2024,
  https://doi.org/10.1038/s41598-024-69867-6 (CC BY)
- **Lever:** temperature, time; roast level; immersion.
- **For the app:** prompt rule. For dark roasts, a cooler temperature is
  the first suggestion for bitter, smoky, burnt or astringent cups. For
  light roasts, a cooler temperature lowers extraction more than it removes
  harshness, so pair it with a finer grind or a longer contact time, or
  keep the cold part to a bloom. Insight: rating vs temperature by roast
  level, and sweetness notes vs temperature for dark roasts.

### Hot water extracts more titratable acid, without changing pH

- **Finding:** For six light(-to-medium) roasts, a 6-minute boiling-water
  immersion and a 7-hour room-temperature cold brew at the same ratio had
  similar pH, but the hot brews had more titratable acid, more chlorogenic
  acids and higher antioxidant activity.
- **Evidence:** peer-reviewed (chemistry only, no sensory; pre-ground
  commercial coffee).
- **Source:** Rao, Fuller, "Acidity and Antioxidant Activity of Cold Brew
  Coffee", Scientific Reports 8:16030, 2018,
  https://doi.org/10.1038/s41598-018-34392-w (CC BY)
- **Lever:** temperature; immersion; light roasts.
- **For the app:** prompt rule. "More acidity" and "brighter" cups point
  toward hotter water for light roasts; cooler water mutes acidity. Pairs
  with Gagné's untested remark that cooler slurry tasted less bright.

### A blind single-variable temperature test on a light roast (84-96 °C)

- **Finding:** Hedrick brewed one light roast in a plastic V60 (15 g to
  250 g, three pours, same grind) at 96, 93, 90, 87 and 84 °C. In blind
  tasting he preferred 90-93 °C. 96 °C was more complex but had roasty,
  caramelised bitterness; 87 °C had juicier acidity but less sweetness and
  balance; 84 °C was dull and flat. Extraction fell by about 1.5 points
  from hottest to coolest.
- **Evidence:** controlled hobbyist test (one taster, one coffee, one
  brew each); **content verified only through a third-party summary of the
  video**, not the video itself.
- **Source:** Lance Hedrick, "How Brewing Temperature Affects Coffee
  Taste", YouTube, 2026-03-27, https://www.youtube.com/watch?v=SsZHPcQcGIw
  (no chapters; timestamps not checked; summary read at
  https://youtubesummary.com/summary/SsZHPcQcGIw).
- **Lever:** temperature; light roast, V60.
- **For the app:** prompt rule. About 12 °C across the usual range moved
  extraction by only about 1.5 points: temperature is a fine-tuning lever
  for pour-over. Even for light roasts, "hotter is always better" isn't a
  safe default when the cup is bitter or roasty.

### The "Samo bloom": a 50-60 °C bloom, then hot pours

- **Finding:** Hedrick's "Samo bloom" (named after ZHAW's Samo Smrke) blooms
  with water at about 50-60 °C and finishes with near-boiling pours. The
  claim is that a cooler bloom keeps volatile aromatics that hot water would
  drive off. In the description he credits Rubens Gardelli, who used a 62 °C
  bloom at the 2014 World Brewers Cup and gave the same aroma reasoning.
  Secondary write-ups give a 45 g bloom held to 2:00, then 95 °C pours.
- **Evidence:** expert opinion and one tasting (the "Taste Test" chapter).
  Recipe details come from the description and secondary recipe sites; the
  spoken content was not checked.
- **Source:** Lance Hedrick, "TRY THIS HACK FOR BETTER POUROVERS: Samo
  Bloom", YouTube, 2023-11-21, https://www.youtube.com/watch?v=eVF7DOxOUFA
  (chapters: 0:45 explanation, 3:44 volatile organic compounds, 11:07
  recipe, 12:44 taste test); recipe summary at
  https://aeroprecipe.com/recipes/lance-hedrick-samo-bloom ; Gardelli's
  routine: "2014 World Brewers Cup, Final Round (Rubens Gardelli, Italy)",
  YouTube, 2014-11-13, https://www.youtube.com/watch?v=45t2OQLkjoY (not
  watched).
- **Lever:** bloom, temperature; pour-over, mostly light roasts.
- **For the app:** new suggestion output: a separate bloom temperature
  (the bloom step's own `targetTempC`). Offer it as an experiment for
  aroma-focused light roasts, presented as a practitioner technique rather
  than a proven fix. In the chat, the cold bloom and hot-then-cooler staging
  ideas are sent as "Experiment ideas" and offered as `experiment: true`
  recipe cards (`docs/api/chat.md` §12), never in analysis or Suggest.

### Room-temperature bloom variants are reported as sweeter

- **Finding:** A Japanese home brewer describes a later variant popularised
  by Philocoffea barista Rikuto Tanaka: a bloom with water at or below
  room temperature (about 20-30 °C) and a longer 1-2 minute bloom. The author
  found it noticeably sweeter than Hedrick's 50-60 °C version, worth trying
  on medium-dark roasts too, and says the mechanism is only a hypothesis.
  A longer total time (over 4 minutes) was hard to avoid.
- **Evidence:** expert opinion / anecdote (single home brewer, not blind).
- **Source:** うだつ (udatsu), "Do you know about Samo Bloom? (And its
  compatibility with the HARIO V60 NEO)", note.com, undated (written 2025 or later),
  https://note.com/udatsunoagaru919/n/n165cbc55ce4a?hl=en
- **Lever:** bloom, temperature, time; pour-over.
- **For the app:** none yet. If the bloom-temperature output is added,
  cold blooms of 20-60 °C are all in use, and a long cold bloom lengthens the
  brew. Insight candidate: rating vs bloom-step temperature.

### Why a cool bloom might help: evaporation after extraction

- **Finding:** In ZHAW espresso work, Smrke and colleagues argue that the
  aroma in the cup depends both on how much is extracted and on how much
  evaporates afterwards from the flowing brew and the cup. They suggest that
  an earlier finding (more volatiles at higher temperatures) may partly
  reflect more evaporation from hotter brew rather than better extraction.
  None of this tests blooms or filter coffee.
- **Evidence:** peer-reviewed (espresso, PTR-ToF-MS aroma measurements and
  sensory; temperature not varied in the 2024 study).
- **Source:** Smrke, Eiermann, Yeretzian, "The role of fines in espresso
  extraction dynamics", Scientific Reports 14:5612, 2024,
  https://doi.org/10.1038/s41598-024-55831-x (CC BY); the earlier
  temperature data: Sánchez López et al., "Extraction kinetics of coffee
  aroma compounds using a semi-automatic machine: on-line analysis by
  PTR-ToF-MS", International Journal of Mass Spectrometry 401:22-30, 2016,
  https://www.sciencedirect.com/science/article/pii/S1387380616000440
  (82, 92 and 96 °C espresso; abstract only seen).
- **Lever:** temperature, bloom; espresso (by analogy filter).
- **For the app:** prompt rule. If the AI explains a cold bloom, it should
  call the aroma argument plausible, not proven.

### Hot-then-cool staging: Kasuya's Switch "Devil" recipe

- **Finding:** Kasuya's Hario Switch recipe (20 g, 280 g) pours 60 g and
  then up to 120 g at about 90 °C with the valve open, cools the kettle to
  about 70 °C with cold water, closes the valve at 1:15 for the rest of the
  water, and opens at 1:45 to finish around 3:00. His reasoning, as reported:
  the good compounds come out early and hot, and the later, less pleasant
  ones are eased off by cooler immersion. He warns the cup ends up cooler
  than usual. Reviewers report a smoother, cleaner, sweeter cup.
- **Evidence:** expert opinion (2016 World Brewers Cup champion), with
  tasting reports from home brewers; no measurements.
- **Source:** Tetsu Kasuya, "Is it the God Recipe, or the Devil Recipe?
  ｜The Ultimate Switch Recipe Ever!!", YouTube, 2023-02-09,
  https://www.youtube.com/watch?v=gC8K40kZ_6E (4:12 extraction concept and
  recipe, temperature; 16:30 tasting; spoken content read via the summaries
  below); recipe as summarised by naru, Comori Coffee, 2023-02-25,
  https://comoricoffee.com/en/kasuyas-hario-switch-recipe-en/ ; Roastaroma,
  2024-08-23,
  https://roastaroma.com/2024/08/tetsu-kasuyas-devil-recipe-for-the-hario-switch/
- **Lever:** temperature (per step), time; Hario Switch / immersion
  hybrids; light to medium roasts.
- **For the app:** new suggestion output: per-step temperatures (a hot
  open-valve phase, then a cooler immersion step). Prompt rule: for a Switch
  recipe with harsh or drying finishes, cooling the immersion step is a
  recognised option. Remind users to preheat the cup.

### Kasuya's roast-based kettle temperatures (4:6 method)

- **Finding:** Kasuya's 4:6 guidance sets about 93 °C for light roasts,
  88 °C for medium and 83 °C for dark, and advises against freshly boiled
  water, which he says tastes bitter. No reason is given for the roast
  steps.
- **Evidence:** expert opinion.
- **Source:** Philocoffea, "What Is the 4:6 Method?", 2022-03-07,
  https://en.philocoffea.com/blogs/blog/coffee-brewing-method
- **Lever:** temperature; roast level; V60.
- **For the app:** prompt rule. Experts agree on the direction (darker is
  cooler) but disagree by up to about 7 °C on the numbers for light roasts
  (Kasuya 93 °C vs Hoffmann boiling). The AI should treat roast level as
  setting a range, not a single value.

### Espresso 80 vs 93 °C was hard to tell apart

- **Finding:** In pilot triangle tests, most tasters couldn't tell espresso
  brewed at 80 °C from one brewed at 93 °C. The authors' aim was safer, cooler
  drinks.
- **Evidence:** peer-reviewed pilot (ISO triangle test; untrained tasters;
  panel size not in the abstract).
- **Source:** Klotz, Winkler, Lachenmeier, "Influence of the Brewing
  Temperature on the Taste of Espresso", Foods 9(1):36, 2020,
  https://doi.org/10.3390/foods9010036 (CC BY)
- **Lever:** temperature; espresso.
- **For the app:** none directly (espresso). Supports treating temperature
  as a smaller lever than many users expect.

### Serving temperature confounds what people rate

- **Finding:** Reanalysing over 3,000 consumer tastings, UC Davis found that
  acceptance peaked with the cup around 58-66 °C, and that tasting
  temperature had little effect on perceived flavour intensity, acidity or
  mouthfeel but a slight effect on overall liking.
- **Evidence:** peer-reviewed (consumer data; tasting temperature varied
  naturally between about 56 and 71 °C).
- **Source:** Ristenpart, Cotter, Guinard, "Impact of beverage temperature
  on consumer preferences for black coffee", Scientific Reports 12:20621,
  2022, https://doi.org/10.1038/s41598-022-23904-4 (CC BY)
- **Lever:** none (serving); all methods.
- **For the app:** Insight caveat. Ratings of low-temperature or long-cold-
  bloom brews may partly reflect a cooler cup. A rating-vs-temperature chart
  should say it shows correlation only.

## Disagreements and open questions

- **How big a lever is temperature?** Batali 2020 (87-93 °C, matched
  extraction), Liang 2021 (80-99 °C equilibrium) and Klotz 2020 point to a
  small one in the usual hot range. Hoffmann, Kasuya and Gagné treat it as a
  first-line roast-dependent setting, and Hedrick's blind test found clear
  differences between 84 and 96 °C. These are compatible if temperature acts
  mainly through extraction: the UC Davis studies remove that effect by
  matching extraction, while home brewers change temperature alone and so
  change extraction. The 2022/2024 UC Davis studies show large effects only
  for very large drops (92 → 22 or 4 °C).
- **Light-roast temperature numbers differ.** Kasuya ~93 °C, Hedrick (2026)
  preferring 90-93 °C, Hoffmann and Gagné boiling or 99 °C. Part of this may
  be brewer and pour structure (slurry, not kettle, is what matters), which
  none of them report consistently.
- **Do darker roasts want cooler water?** Expert consensus says yes, and the
  2024 hot-vs-cold data support it for dark roasts. No study tests it at
  small steps (e.g. 85 vs 93 °C) with blinding. A barista Gagné cites
  recommends cooler water for naturals; Gagné reports that Rao and Perger
  disagree, and none of it was blind-tested.
- **Cold bloom mechanism.** The aroma-retention argument is not tested for
  blooms. A cold bloom also slows early extraction and degassing, which may
  be what users taste. Reported bloom temperatures range from room
  temperature to 62 °C, and from 45 s to 2 min.
- **Ceramic vs plastic.** Gagné, Rao and the Runnion data favour plastic or
  find little difference. Some retailers claim thick ceramic "holds heat"
  once preheated. Peer-reviewed thermal data on drippers weren't found.
  Blog tables of exact per-material losses (e.g. papelespresso.com) were
  left out as unsourced.
- **Hoffmann on AeroPress temperatures.** Gagné reports Hoffmann observing
  that many baristas preferred light roasts near 80 °C or above 90 °C in
  AeroPress, but not in between, and that the AeroPress's insulation may
  explain lower preferred temperatures there. **Unverified**: the Hoffmann
  source wasn't found (Gagné, "Reaching Fuller Flavor Profiles with the
  AeroPress", 2021-09-07,
  https://coffeeadastra.com/2021/09/07/reaching-fuller-flavor-profiles-with-the-aeropress/).
- **Not covered:** controlled data on hot-bloom-then-cooler pours vs the
  reverse, or on slurry temperature during a Switch immersion. Barista
  Hustle's double-wall brewer test and the Jeff Verellen low-temperature
  AeroPress interview are paywalled and were not read.

## Sources

- Batali ME, Ristenpart WD, Guinard JX (2020). Brew temperature, at fixed
  brew strength and extraction, has little impact on the sensory profile of
  drip brew coffee. Sci Rep 10:16450. https://doi.org/10.1038/s41598-020-73341-4
- Batali ME, Lim LX, Liang J, et al. (2022). Sensory Analysis of Full
  Immersion Coffee: Cold Brew Is More Floral, and Less Bitter, Sour, and
  Rubbery Than Hot Brew. Foods 11(16):2440. https://doi.org/10.3390/foods11162440
- Cotter AR, Batali ME, Ristenpart WD, Guinard JX (2021). Consumer
  preferences for black coffee are spread over a wide range of brew
  strengths and extraction yields. J Food Sci. https://doi.org/10.1111/1750-3841.15561
- Klotz JA, Winkler G, Lachenmeier DW (2020). Influence of the Brewing
  Temperature on the Taste of Espresso. Foods 9(1):36. https://doi.org/10.3390/foods9010036
- Liang J, Chan KC, Ristenpart WD (2021). An equilibrium desorption model
  for the strength and extraction yield of full immersion brewed coffee.
  Sci Rep 11:6904. https://doi.org/10.1038/s41598-021-85787-1
- Liang J, Batali ME, Routt C, Ristenpart WD, Guinard JX (2024). Sensory
  analysis of the flavor profile of full immersion hot, room temperature,
  and cold brewed coffee over time. Sci Rep 14:19298. https://doi.org/10.1038/s41598-024-69867-6
- Rao NZ, Fuller M (2018). Acidity and Antioxidant Activity of Cold Brew
  Coffee. Sci Rep 8:16030. https://doi.org/10.1038/s41598-018-34392-w
- Ristenpart WD, Cotter AR, Guinard JX (2022). Impact of beverage
  temperature on consumer preferences for black coffee. Sci Rep 12:20621.
  https://doi.org/10.1038/s41598-022-23904-4
- Sánchez López JA, et al. (2016). Extraction kinetics of coffee aroma
  compounds using a semi-automatic machine: on-line analysis by PTR-ToF-MS.
  Int J Mass Spectrom 401:22-30. https://www.sciencedirect.com/science/article/pii/S1387380616000440
- Smrke S, Eiermann A, Yeretzian C (2024). The role of fines in espresso
  extraction dynamics. Sci Rep 14:5612. https://doi.org/10.1038/s41598-024-55831-x
- Gagné J. How to Brew Better Coffee with a V60. Coffee ad Astra,
  2018-11-30. https://coffeeadastra.com/2018/11/30/brewing-better-coffee/
- Gagné J. Extraction Uniformity and Channeling. Coffee ad Astra,
  2019-10-04. https://coffeeadastra.com/2019/10/04/extraction-uniformity-and-channeling/
- Gagné J. Brewing with the Fellow Stagg [X] Dripper. Coffee ad Astra,
  2020-12-09. https://coffeeadastra.com/2020/12/09/brewing-with-the-fellow-stagg-x-dripper/
- Gagné J. Reaching Fuller Flavor Profiles with the AeroPress. Coffee ad
  Astra, 2021-09-07. https://coffeeadastra.com/2021/09/07/reaching-fuller-flavor-profiles-with-the-aeropress/
- Gagné J. The Pulsar Dripper. Coffee ad Astra, 2023-09-13.
  https://coffeeadastra.com/2023/09/13/the-pulsar-dripper/
- Barista Hustle. Pour-over slurry temperature (Colin Runnion's
  measurements). https://www.baristahustle.com/?p=333089 (paywalled; search
  excerpts only)
- Hoffmann J. Brew your coffee with boiling water - coffee brewing
  temperatures explained. YouTube, 2020-03-03. https://www.youtube.com/watch?v=K_r5kpXPRYo
- Hedrick L. TRY THIS HACK FOR BETTER POUROVERS: Samo Bloom. YouTube,
  2023-11-21. https://www.youtube.com/watch?v=eVF7DOxOUFA
- Hedrick L. How Brewing Temperature Affects Coffee Taste. YouTube,
  2026-03-27. https://www.youtube.com/watch?v=SsZHPcQcGIw
- Gardelli R. 2014 World Brewers Cup, Final Round. YouTube, 2014-11-13.
  https://www.youtube.com/watch?v=45t2OQLkjoY
- Kasuya T. Is it the God Recipe, or the Devil Recipe?｜The Ultimate Switch
  Recipe Ever!! YouTube, 2023-02-09. https://www.youtube.com/watch?v=gC8K40kZ_6E
- Philocoffea. What Is the 4:6 Method? 2022-03-07.
  https://en.philocoffea.com/blogs/blog/coffee-brewing-method
- naru. Tetsu Kasuya's New Hario Switch Recipe. Comori Coffee, 2023-02-25.
  https://comoricoffee.com/en/kasuyas-hario-switch-recipe-en/
- Roastaroma. Tetsu Kasuya's "Devil" Recipe for the Hario Switch.
  2024-08-23. https://roastaroma.com/2024/08/tetsu-kasuyas-devil-recipe-for-the-hario-switch/
- AeroPrecipe. Lance Hedrick - Samo Bloom.
  https://aeroprecipe.com/recipes/lance-hedrick-samo-bloom
- udatsu. Do you know about Samo Bloom? note.com, undated (2025 or later).
  https://note.com/udatsunoagaru919/n/n165cbc55ce4a?hl=en
- youtubesummary.com. Summary of "How Brewing Temperature Affects Coffee
  Taste". https://youtubesummary.com/summary/SsZHPcQcGIw
