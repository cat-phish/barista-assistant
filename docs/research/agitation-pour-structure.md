# Agitation, bloom and pour structure

Bloom ratio and time, pulses vs one continuous pour, pour height and flow,
swirl vs stir, fines migration, bed depth, brewer geometry, drawdown, and
immersion vs percolation. Researched November 2026. Most of this field is
expert opinion and hobbyist testing; only a few points (immersion
equilibrium, pour-jet mixing, basket geometry, degassing kinetics) rest on
peer-reviewed work. Each entry says which.

## Summary

1. **Bloom with about 2 to 3 times the dose in water and make sure every
   ground is wet.** The common expert ranges (Hoffmann 2x, Rao, Gagné and
   Hedrick 3x) agree; the goal is even saturation before the main pour, not
   a magic number. Expert opinion.
2. **Bloom length is a flavour lever, not just a degassing wait.** Longer
   blooms (up to about 2 min) push extraction and body; shorter ones keep
   the cup more aromatic and delicate. Expert opinion, consistent across
   Rao and Hedrick.
3. **Fewer, larger pours are the default advice from several experts; more
   pulses add agitation, extraction and drawdown time.** Rao and Hedrick
   argue against many pours; Hoffmann and Kasuya use 5 pours deliberately
   (small doses, or to split flavour). This is a real disagreement, so the
   AI should treat pour count as a lever with a direction, not a rule.
4. **Kasuya's 4:6: the first 40% of the water sets acidity vs sweetness,
   the number of pours in the last 60% sets strength.** A larger first pour
   gives more acidity, a smaller one more sweetness. Expert opinion from a
   World Brewers Cup winner; no controlled test found.
5. **Agitation helps until it moves fines to the filter.** A short swirl or
   Rao spin breaks channels and flattens the bed; long or vigorous spinning
   and stirring send fines down, clog the paper and slow the drawdown.
   Hobbyist measurements (Gagné) and expert agreement.
6. **Drawdown time is a diagnostic only relative to bed depth, dose and
   recipe.** A slow drawdown means too fine, too many fines, too much late
   agitation, or a deeper bed; a fast one the opposite. Gagné's V60 range is
   about 2:30 to 3:30 for 22 g. Expert opinion.
7. **Pour from a moderate height with a thick, unbroken stream.** Height
   adds mixing via small avalanches in the bed; a stream that breaks into
   drops or traps air mixes worse. Peer-reviewed (Park et al. 2025), lab
   setup.
8. **Immersion extraction is equilibrium-limited (about 21% regardless of
   ratio, grind and temperature); percolation is not.** In an immersion
   brewer, ratio sets strength and extraction barely moves; in pour-over,
   flow, pours and agitation do move it. Peer-reviewed (UC Davis, Liang et
   al. 2021).
9. **Bed depth and brewer geometry change the cup.** Deeper beds need a
   coarser grind or longer brew and are more forgiving; cone vs flat baskets
   give different TDS and flavour, interacting with roast. Peer-reviewed for
   geometry (Frost et al. 2019), hobbyist for bed depth.
10. **Fresh coffee releases most CO2 in its first days to weeks, which is why
    fresh beans bloom hard and may extract unevenly.** Degassing kinetics are
    peer-reviewed (Smrke et al. 2018); the effect on extraction is mostly
    practitioner consensus.

---

### Bloom ratio: about 2 to 3 times the dose, enough to wet everything

- **Finding:** Experts converge on a bloom (pre-wet) of roughly twice to
  three times the coffee weight in water, aiming to saturate the whole bed
  before the main pour. Rao uses about 3:1 so the bed fully saturates;
  Gagné uses 66 g for 22 g (3:1); Hoffmann's Ultimate V60 uses 60 g for 30 g
  (2:1); Hedrick's recipes use 3x the dose.
- **Evidence:** expert opinion. No controlled comparison of bloom ratios was
  found.
- **Source:** Scott Rao, "Some Observations on Hand Pours", scottrao.com,
  2016-10-08, https://scottrao.com/blog/2016/10/8/some-observations-on-hand-pours;
  Jonathan Gagné, "Brewing Better Coffee" (V60 recipe), Coffee ad Astra,
  2018-11-30 (updated 2019),
  https://coffeeadastra.com/2018/11/30/brewing-better-coffee/; Hario USA,
  "James Hoffmann - Ultimate V60 Technique",
  https://www.hario-usa.com/blogs/recipes-and-more-from-friends/james-hoffmann-uitimate-v60-technique;
  Lance Hedrick, "ULTIMATE POUROVER RECIPE (any method)", YouTube (c. 2023,
  exact date unverified), https://www.youtube.com/watch?v=BG5Tc8MR2_4 at
  about 05:07 (timestamp from a third-party AI summary,
  https://readray.ai/notes/981794, not checked against the video).
- **Lever:** bloom; percolation brewers (V60, flat-bottom).
- **For the app:** new suggestion output: a bloom step's `targetWaterGrams`
  of 2 to 3 x dose. Prompt rule: if a recipe's bloom is under 2x dose and
  notes say "dry clumps" or "uneven bed", suggest a bigger bloom before a
  finer grind.

### Agitate the bloom only as much as it takes to wet all grounds

- **Finding:** Rao recommends agitating during the pre-wet so bubbling stops
  within about 10 to 15 s, using the minimum agitation needed because extra
  agitation moves fines into the filter; passive pre-wets gave him more
  variable refractometer readings. Gagné replaces spoon-stirring the bloom
  with a Rao spin because spoon agitation is hard to repeat. Hoffmann swirls
  the bloom until the slurry looks evenly mixed.
- **Evidence:** expert opinion with informal refractometer observations
  (Rao); no n reported.
- **Source:** Rao 2016 (above); Gagné 2018 (above); Hario USA Hoffmann page
  (above).
- **Lever:** bloom, agitation; percolation.
- **For the app:** new suggestion output: a `swirl` step right after the
  bloom pour as the default; reserve `stir` for when notes report dry
  pockets. Prompt rule: prefer swirl over stir when the user wants
  repeatability.

### Stirring the bloom: the effect depended on batch size

- **Finding:** Barista Hustle's bloom series found that stirring a 15 g
  bloom made the grounds absorb less water with no measurable change in
  extraction, while in 30 g brews stirring made them absorb more water and
  sharply raised the TDS of the liquid leaving the bloom. A gentle
  "bird's nest" stir had no measurable effect. They conclude there is no
  single best bloom.
- **Evidence:** controlled hobbyist test (single site, small dataset by their
  own account). Partially verified: the articles are paywalled, and the
  points above come from search-engine excerpts of them, not the full text.
- **Source:** Barista Hustle, "Blooming Marvellous",
  https://www.baristahustle.com/?p=373635; Barista Hustle, "The Rules of
  Blooming", https://www.baristahustle.com/?p=378733 (both c. 2021).
- **Lever:** bloom, agitation; dose-dependent.
- **For the app:** prompt rule: for doses of about 25 g and up, a stirred
  bloom is a reasonable way to raise extraction; for single cups, don't
  expect much from it. Low confidence.

### Bloom length moves extraction and body vs aroma

- **Finding:** Longer blooms tend to raise extraction and give heavier,
  less aromatic cups; shorter blooms give more aromatic, delicate cups (Rao,
  writing about no-bypass brewers). Hedrick uses blooms of 1 to 2 minutes,
  up to 2 minutes for dense washed coffees that under-extract on his usual
  recipe.
- **Evidence:** expert opinion. Rao says he is unsure of the mechanism.
- **Source:** Scott Rao, "What I've learned from no-bypass brewing",
  scottrao.com, 2023-11-09, https://www.scottrao.com/blog/no-bypass-lessons;
  Hedrick, "ULTIMATE POUROVER RECIPE (any method)" (above), about 05:07 (via
  the third-party summary); jos, "How important is the 'bloom' in a
  pourover?", Undissolved Solids (undated),
  https://undissolvedsolids.com/how-important-is-the-bloom-in-a-pourover/
  (secondhand summary of Hedrick and April Coffee).
- **Lever:** bloom, time; light, dense, washed coffees in particular.
- **For the app:** new suggestion output: bloom `durationSec` (30 to 120).
  Prompt rule: for a sour/thin light roast, a longer bloom is an
  alternative to grinding finer; for a flat, muted cup, try a shorter
  bloom. Insight: bloom duration vs rating per bean.

### Fresh coffee degasses fastest early; that is what the bloom manages

- **Finding:** Smrke et al. built a time-resolved weighing method for CO2
  loss from roasted coffee and modelled its decline; the SCA's summary of
  the work says release is fastest in roughly the first 20 days after
  roasting. Practitioners widely hold that escaping gas pushes water away
  from grounds and hinders even wetting, and Gagné reads a lively bloom as
  a sign of fresh coffee and a quiet one as possibly stale.
- **Evidence:** peer-reviewed for degassing kinetics; the link to uneven
  extraction is expert opinion (no peer-reviewed brewing test found).
- **Source:** S. Smrke et al. (ZHAW, with C. Yeretzian), "Time-Resolved Gravimetric Method To Assess Degassing of
  Roasted Coffee", J. Agric. Food Chem. 66(21), 2018,
  https://doi.org/10.1021/acs.jafc.7b03310; SCA, "Coffee Decoded: What is
  freshly roasted coffee?",
  https://sca.coffee/sca-news/coffee-decoded-9-fresh-coffee; Gagné 2018
  (above).
- **Lever:** rest, bloom; all roasts, strongest in the first days after
  roasting.
- **For the app:** prompt rule: when days-off-roast is small (under about a
  week), suggest a longer or more agitated bloom before changing grind; when
  the user notes "no bloom", consider stale coffee. Rest itself is covered
  in `strength-water-rest.md`.

### Pre-wetting helps percolation, not immersion

- **Finding:** Rao argues a pre-wet reduces channeling and improves
  uniformity in percolation, because water otherwise favours already-wet
  grounds; in immersion it gives some grounds a head start with clean water
  and cools the slurry, so pouring all the water at once is better. He calls
  pre-wetting "beneficial for percolation brewing but not for immersion
  brewing."
- **Evidence:** expert opinion; Rao concedes good pre-wetted immersion brews
  are possible and suggests side-by-side tests.
- **Source:** Scott Rao, "Prewetting: When to do it, when not to",
  scottrao.com, 2016-10-27,
  https://www.scottrao.com/blog/prewetting-when-to-do-it-when-not-to
- **Lever:** bloom; method (pour-over vs French press, Clever, closed
  Switch).
- **For the app:** prompt rule: don't suggest bloom changes as a fix for a
  full-immersion brew; for immersion suggest ratio, grind, steep time.

### Immersion reaches an equilibrium; ratio sets strength, not extraction

- **Finding:** In full immersion, extraction yield stayed near 21% across
  brew ratios of about 2 to 25, grind medians of roughly 0.6 to 1.3 mm and
  temperatures of 80 to 99 °C, while TDS fell roughly in inverse proportion
  to the ratio. Flow-through methods, by contrast, can reach a wider range
  of strength and extraction combinations. Oven-drying spent grounds
  underestimates true extraction.
- **Evidence:** peer-reviewed (1 L beaker brews and cupping coffees, with an
  equilibrium desorption model). CC BY 4.0.
- **Source:** J. Liang, K. C. Chan, W. D. Ristenpart, "An equilibrium
  desorption model for the strength and extraction yield of full immersion
  brewed coffee", Scientific Reports 11, 6904, 2021,
  https://doi.org/10.1038/s41598-021-85787-1
- **Lever:** ratio, time; immersion brewers (French press, Clever, Switch
  closed, AeroPress steeps).
- **For the app:** prompt rule: for an immersion recipe, a "weak" cup means
  change the ratio; a sour cup may mean the steep ended before equilibrium
  (longer steep), not a finer grind. Grind and temperature are weak levers
  once equilibrium is reached.

### One continuous pour vs several pulses

- **Finding:** Rao prefers adding all post-bloom water in one steady pour,
  saying it keeps the slurry hot, and that staged pours tend to give
  soggy, sour coffee. Hedrick advises against multiple pours, saying more
  pours mean more extraction, a stalled drawdown and more bitterness, and a
  2025 video has a chapter titled "DO NOT Pour 5+ Times". Hoffmann's
  Ultimate V60 uses two main pours; his 1-cup V60 uses five 50 g pulses
  for 15 g, which secondary write-ups explain as keeping a small, shallow
  bed hot and even.
- **Evidence:** expert opinion. Hedrick's 2026 "Pour Count" video is
  described as an isolated-variable test, but its results could not be
  checked (transcript not accessed), so they are unverified.
- **Source:** Rao 2016 hand pours (above); Hedrick, "ULTIMATE POUROVER
  RECIPE (any method)" (above), about 10:45 (via the third-party summary);
  Lance Hedrick, "Don't Do These 3 Things When Brewing Pour-Over", YouTube,
  2025-12-18, https://www.youtube.com/watch?v=cPE0f0uV3LM, chapter at 8:30
  (claims in it unverified); Lance Hedrick, "A Simple Change with Huge
  Flavor Implications- Pour Count", YouTube, 2026-04-14,
  https://www.youtube.com/watch?v=zLK42wx6naQ (content unverified);
  James Hoffmann, "A Better 1 Cup V60 Technique", YouTube, 2022 (month
  unverified), https://www.youtube.com/watch?v=1oB1oDrDkHM; recipe
  summary at https://www.beeancoffee.com/?p=16051 (secondary).
- **Lever:** agitation, time, temperature; percolation. Pulses matter more
  at small doses.
- **For the app:** new suggestion output: number of `pour` steps. Prompt
  rule: to raise extraction or body without changing grind, add a pour;
  for bitterness or a stalled drawdown with 4+ pours, consolidate pours.
  For doses of about 15 g or less, extra pulses can help keep heat.
  Insight: pour count vs rating and vs drawdown time.

### Kasuya's 4:6: first 40% for acidity/sweetness, last 60% for strength

- **Finding:** The 4:6 method pours the first 40% of the water in two pours
  whose split tunes flavour (more water in the first pour gives more
  acidity, less gives more sweetness), then divides the remaining 60% into
  pours whose count sets strength (more pours, stronger). The reference
  recipe is 20 g coarse coffee, 300 g at 92 °C, pours of 50/70/60/60/60 g at
  0:00, 0:45, 1:30, 2:10, 2:40, off at 3:30, in a V60 without spiral ribs
  that drains more slowly.
- **Evidence:** expert opinion (2016 World Brewers Cup champion's method);
  no controlled test of the sweetness/acidity claim found.
- **Source:** Hario UK, "Hario V60 recipe interview with Hario ambassador
  Tetsu Kasuya", 2022-05-10,
  https://hario.co.uk/blogs/hario-ambassadors/hario-v60-recipe-interview-with-hario-ambassador-tetsu-kasuya
- **Lever:** agitation, ratio (within the brew); coarse grind, V60.
- **For the app:** new suggestion output: re-split the first two pours'
  `targetWaterGrams` (a "too sour" note: shrink pour 1; "flat, needs
  brightness": grow it); change the number of remaining pours for "too
  weak/too strong" when the user wants to keep the ratio. Mark as a
  method-specific heuristic.

### Pour height and stream: thick, laminar, from moderate height

- **Finding:** Using transparent particles in a glass cone and real coffee,
  Park, Young and Mathijssen found that a falling stream causes small
  avalanches in the bed that mix it; higher pours mixed more and gave
  stronger brews with a thick stream, a thin stream gave high extraction at
  all heights (probably because pouring took longer), and a stream from too
  high broke into drops and drew air into the bed, reducing extraction.
  They advise pouring as high as possible while keeping the stream intact.
- **Evidence:** peer-reviewed; lab setup with a single cone angle, so
  generality is limited. Full text not read; findings from the abstract and
  the university/AIP press releases.
- **Source:** E. Park, M. Young, A. J. T. M. Mathijssen, "Pour-over coffee:
  Mixing by a water jet impinging on a granular bed with avalanche
  dynamics", Physics of Fluids 37(4), 043332, 2025,
  https://doi.org/10.1063/5.0257924; Penn Today, 2025-04-09,
  https://penntoday.upenn.edu/news/penn-sas-physics-better-cup-coffee
- **Lever:** agitation; cone pour-over.
- **For the app:** prompt rule: for a weak or under-extracted pour-over, a
  higher (but unbroken) pour or slower pace is a lever besides grind; avoid
  advising "pour from very high". Not loggable today, so advice text only.

### Pour pace: what a reference recipe implies in g/s

- **Finding:** Hoffmann's Ultimate V60 adds 240 g over 30 s then 200 g over
  30 s (about 8 and 7 g/s), the second pour gentler; Gagné prefers gentle
  spiral pours from a consistent height and warns that fast, low pours make
  volume hard to control and leave an uneven bed. Gagné notes that a larger
  batch at the same bed depth needs a faster kettle pour because drip rate
  per unit area stays the same.
- **Evidence:** expert opinion; g/s values are our arithmetic from the
  published recipe, not stated by the author.
- **Source:** Hario USA Hoffmann page (above); Gagné 2018 (above); Gagné
  2025 bed-depth post (below).
- **Lever:** agitation, time; percolation.
- **For the app:** new suggestion output: pour pace as `targetWaterGrams`
  over `durationSec` (around 5 to 8 g/s for a 2-cup V60). Prompt rule: a
  slower pour lengthens contact and raises extraction; a faster one adds
  turbulence. Insight: computed g/s per pour vs rating.

### Rao spin: a short swirl breaks channels; a long one stalls the drawdown

- **Finding:** Gagné explains the spin as pushing slurry outward to wet dry
  pockets and break channels, and argues that larger particles are thrown
  outward more strongly, so long spins leave fines at the bottom of the cone
  where they clog the paper. In his brews, 2 s spins drew down at 4:28 vs
  5:18 for 7 s spins, with the shorter spin tasting brighter; uncontrolled
  spinning varied brew time by about 20 s and extraction by about 0.7%.
  Rao says the spin reduces channeling in the final drawdown and leaves a
  flat spent bed. Barista Hustle reports that adding a swirl did not change
  extraction in side-by-side tests, but over months of dialling in the
  chosen extraction ran about a point higher, which they read as a higher
  ceiling from less channeling (paywalled; seen via search excerpt only).
- **Evidence:** controlled hobbyist test (Gagné, small n, single brewer);
  expert opinion (Rao); Barista Hustle partially verified.
- **Source:** Jonathan Gagné, "Why Spin the Slurry?", guest post on
  scottrao.com, 2019-01-08/09,
  https://scottrao.com/blog/2019/1/8/why-spin-the-slurry; Rao 2016 hand
  pours (above); Barista Hustle, https://www.baristahustle.com/?p=322416.
- **Lever:** agitation; cone brewers.
- **For the app:** new suggestion output: one short `swirl` step (2 to 3 s)
  after the last pour. Prompt rule: if drawdown is slow and the recipe has
  long or repeated swirls, shorten them before grinding coarser.

### Over-agitation moves fines to the filter and clogs it

- **Finding:** Excess agitation, especially stirring into the bed or long
  spinning, lets fines collect against the paper and block pores, slowing
  or stalling the drawdown; Rao and Barista Hustle both advise the minimum
  agitation that wets the bed, and Gagné notes slightly larger-pored filters
  allow finer grinds without clogging. Hedrick uses this on purpose: with a
  low-fines grinder, a late stir can slow a too-fast drawdown.
- **Evidence:** expert opinion and hobbyist observation; no peer-reviewed
  filter-clogging study in pour-over was found.
- **Source:** Rao 2016 hand pours (above); Gagné 2019 spin post (above);
  Gagné 2018 V60 post comments (above); Hedrick, "ULTIMATE POUROVER RECIPE
  (any method)" (above), about 09:25 to 10:02 (via the third-party summary).
- **Lever:** agitation, grind; paper-filter percolation; worse with grinders
  that make many fines.
- **For the app:** prompt rule: a "stalled drawdown" with heavy agitation in
  the steps points first at agitation (fewer stirs, shorter swirls), then
  grind. A fast drawdown with a low-fines grinder can be slowed by a late
  stir instead of grinding finer.

### Drawdown time: read it against the recipe, then adjust grind

- **Finding:** Gagné gives about 2:30 to 3:30 as a typical total time for
  his 22 g V60, says better grinders give shorter and more consistent times,
  recommends logging them, and grinds coarser when slow and finer when fast.
  Hoffmann's Ultimate V60 targets finishing by about 3:30 and notes that
  hotter water and the filter paper also change drawdown. Hedrick reacts
  during the drawdown: a single swirl if slow, a stir if fast.
- **Evidence:** expert opinion.
- **Source:** Gagné 2018 (above); Hario USA Hoffmann page (above); Hedrick
  "ULTIMATE POUROVER RECIPE (any method)" (above), about 09:25.
- **Lever:** grind, time, agitation; percolation, dose-dependent.
- **For the app:** prompt rule: compare drawdown time with this user's
  previous brews of the same recipe and dose, not a universal target; a
  change of more than about 20 s at the same settings is a signal (fines,
  agitation, filter batch, freshness). Insight: drawdown time vs rating per
  recipe, and drawdown variance as a consistency score.

### Bed depth changes flavour, forgiveness and the right grind

- **Finding:** Deeper beds need a longer brew and/or a coarser grind, give
  more body and sweetness and are more forgiving, while shallow beds are
  finicky because a channel affects a larger share of the flow. With bed
  depth, ratio, grind and temperature fixed, a wider or narrower brewer
  makes the same coffee in a different quantity, so dose should scale with
  brewer area. Gagné also suspects deeper beds filter more fines and
  astringent compounds (stated as a hypothesis).
- **Evidence:** hobbyist testing and expert opinion (single grinder and
  brewer family; the cheat-sheet values are in images we did not read).
- **Source:** Jonathan Gagné, "The Importance of Bed Depth", Coffee ad
  Astra, 2025-11-28 (updated 2025-12-31),
  https://coffeeadastra.com/2025/11/28/the-pulsar-mini-and-the-importance-of-bed-depth/;
  Gagné 2018 V60 post (above), on smaller doses raising channeling risk.
- **Lever:** grind, time; all percolation brewers, especially flat-bottom.
- **For the app:** prompt rule: when the user changes dose in the same
  brewer, expect the drawdown to change and adjust grind with it (bigger
  dose, coarser); don't diagnose a slower drawdown at a higher dose as
  "too fine" on its own. For small doses, note extra sensitivity.

### Brewer geometry: cone vs flat baskets, ribs and bypass

- **Finding:** In UC Davis tests of drip brewing, a semi-conical basket
  gave significantly higher TDS than a flat one, and geometry interacted
  with roast level on several flavour attributes that drove consumer
  liking; the SCA write-up describes light roast in the cone as more
  sour/citrus/berry and in the flat basket as more dried-fruit and sweet
  floral. Kasuya's rib-less V60 drains more slowly to suit the 4:6 method.
  Rao reports that bypass (water running down the paper above the bed) in
  V60 and Kalita lowers the extraction ceiling compared with no-bypass
  brewers.
- **Evidence:** peer-reviewed for basket geometry (descriptive panel,
  discrimination tests and 85 consumers; brew strength was not held
  constant, so some of the difference may be strength); expert opinion for
  the rest.
- **Source:** S. C. Frost, W. D. Ristenpart, J.-X. Guinard, "Effect of
  Basket Geometry on the Sensory Quality and Consumer Acceptance of Drip
  Brewed Coffee", Journal of Food Science 84(8), 2297-2312, 2019,
  https://doi.org/10.1111/1750-3841.14696; Hario UK Kasuya interview
  (above); Rao 2023 no-bypass post (above).
- **Lever:** method/brewer; interacts with roast.
- **For the app:** prompt rule: suggestions should not transfer grind or
  timing advice between a cone (V60) and a flat bed (Kalita, Pulsar)
  without saying so; expect a flat bed to need
  a different grind at the same dose. Insight: rating by brewer for the
  same bean.

### Slurry heat loss: slow drawdowns and small pulses cool the brew

- **Finding:** Rao notes that slow drawdowns, especially in open brewers
  like the Chemex, lose heat and lower extraction temperature, and prefers
  one pour to keep the slurry hot. Gagné recommends keeping water above the
  bed so it isn't exposed, using a plastic V60 to hold heat, and warns that
  very small pour batches can drop the slurry below about 91 °C. Gagné also
  notes that letting the water column disappear draws air into the bed,
  slowing drip rate and cooling it.
- **Evidence:** expert opinion with slurry thermometer readings (Gagné).
- **Source:** Rao 2016 hand pours (above); Gagné 2018 V60 post (above);
  Gagné 2025 bed-depth post (above).
- **Lever:** temperature, agitation; small doses, ceramic/glass brewers.
- **For the app:** prompt rule: when the brewer is ceramic or glass and the
  dose small, suggest fewer pauses where the bed runs dry, or a plastic
  brewer, before raising kettle temperature. See also
  `cold-bloom-low-temp.md` for brewer heat loss.

---

## Disagreements and open questions

- **Pour count.** Rao and Hedrick argue for one or two pours and against
  many pulses (soggy/sour per Rao; over-extraction, bitterness and stalled
  drawdown per Hedrick); Hoffmann (1-cup) and Kasuya use five pours by
  design. Note the direction of their complaints differs: Rao blames pulses
  for under-extraction (heat loss), Hedrick for over-extraction (more
  agitation). Both may be right in different settings (small vs large dose,
  plastic vs ceramic brewer). Hedrick's 2026 isolated-variable test of pour
  count could not be verified.
- **Bloom agitation.** Rao says agitate the bloom; Barista Hustle found
  stirring did little for 15 g and a lot for 30 g; others (Matt Winton, per
  Barista Hustle excerpts) avoid stirring for consistency. Swirl vs stir is
  partly a repeatability choice rather than a flavour one.
- **Swirl/spin effect size.** Gagné measured a drawdown penalty for long
  spins; Barista Hustle found no immediate extraction change from a swirl
  but a higher ceiling over time. Neither is a controlled sensory study.
- **Pour height.** Park et al. say pour as high as the stream stays intact;
  Gagné advises a consistent, not necessarily high, pour; Rao lists height
  as a way to add turbulence. Nobody has published numbers a home brewer
  can follow (cm, g/s).
- **Kettle flow rate.** We found no source giving recommended g/s values
  beyond what can be derived from published recipes. Gagné's book has a
  kettle chapter but we did not read it.
- **CO2 and extraction.** That gas hinders wetting is widely repeated but
  we found no peer-reviewed brewing test isolating it. A 2026 Thai study
  reported better extraction after 17 to 25 days of rest, but we could not
  read it; treat as unverified.
- **Kasuya's sweetness/acidity split** has not been tested blind as far as
  we found.
- **Sources we could not reach.** Barista Hustle's articles are paywalled
  (claims above are from search excerpts); Gagné's book *The Physics of
  Filter Coffee* (2021) was not read; YouTube transcripts were not
  accessed, so Hedrick timestamps come from a third-party AI summary and
  other video claims are marked unverified. No Hendon, Smrke (brewing, not
  degassing) or Orea-specific work on pour structure was found.

## Sources

- Barista Hustle, "Blooming Marvellous", c. 2021,
  https://www.baristahustle.com/?p=373635 (paywalled)
- Barista Hustle, "The Rules of Blooming", c. 2021,
  https://www.baristahustle.com/?p=378733 (paywalled)
- Barista Hustle, swirl article, https://www.baristahustle.com/?p=322416
  (paywalled)
- Frost, Ristenpart, Guinard, J. Food Sci. 84(8), 2019,
  https://doi.org/10.1111/1750-3841.14696
- Gagné, "Brewing Better Coffee", Coffee ad Astra, 2018-11-30,
  https://coffeeadastra.com/2018/11/30/brewing-better-coffee/
- Gagné, "Why Spin the Slurry?", scottrao.com, 2019-01-08,
  https://scottrao.com/blog/2019/1/8/why-spin-the-slurry
- Gagné, "The Importance of Bed Depth", Coffee ad Astra, 2025-11-28,
  https://coffeeadastra.com/2025/11/28/the-pulsar-mini-and-the-importance-of-bed-depth/
- Hario UK, Tetsu Kasuya interview, 2022-05-10,
  https://hario.co.uk/blogs/hario-ambassadors/hario-v60-recipe-interview-with-hario-ambassador-tetsu-kasuya
- Hario USA, "James Hoffmann - Ultimate V60 Technique",
  https://www.hario-usa.com/blogs/recipes-and-more-from-friends/james-hoffmann-uitimate-v60-technique
- Hedrick, "ULTIMATE POUROVER RECIPE (any method)", YouTube, c. 2023,
  https://www.youtube.com/watch?v=BG5Tc8MR2_4; third-party summary
  https://readray.ai/notes/981794
- Hedrick, "Don't Do These 3 Things When Brewing Pour-Over", YouTube,
  2025-12-18, https://www.youtube.com/watch?v=cPE0f0uV3LM
- Hedrick, "A Simple Change with Huge Flavor Implications- Pour Count",
  YouTube, 2026-04-14, https://www.youtube.com/watch?v=zLK42wx6naQ
- Hoffmann, "A Better 1 Cup V60 Technique", YouTube, 2022,
  https://www.youtube.com/watch?v=1oB1oDrDkHM
- Liang, Chan, Ristenpart, Sci. Rep. 11, 6904, 2021 (CC BY 4.0),
  https://doi.org/10.1038/s41598-021-85787-1
- Park, Young, Mathijssen, Phys. Fluids 37(4), 043332, 2025,
  https://doi.org/10.1063/5.0257924
- Penn Today, "For a better cup of coffee, look to physics", 2025-04-09,
  https://penntoday.upenn.edu/news/penn-sas-physics-better-cup-coffee
- Rao, "Some Observations on Hand Pours", 2016-10-08,
  https://scottrao.com/blog/2016/10/8/some-observations-on-hand-pours
- Rao, "Prewetting: When to do it, when not to", 2016-10-27,
  https://www.scottrao.com/blog/prewetting-when-to-do-it-when-not-to
- Rao, "What I've learned from no-bypass brewing", 2023-11-09,
  https://www.scottrao.com/blog/no-bypass-lessons
- SCA, "Coffee Decoded: What is freshly roasted coffee?",
  https://sca.coffee/sca-news/coffee-decoded-9-fresh-coffee
- Smrke et al., J. Agric. Food Chem. 66(21), 2018,
  https://doi.org/10.1021/acs.jafc.7b03310
- Undissolved Solids, "How important is the 'bloom' in a pourover?",
  https://undissolvedsolids.com/how-important-is-the-bloom-in-a-pourover/
