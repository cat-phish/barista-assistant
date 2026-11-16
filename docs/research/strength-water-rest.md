# Strength, water and rest

The 2023 UC Davis/SCA brew control chart, brew ratio as a lever separate
from extraction, water chemistry, rest and degassing, and freezing.
Researched November 2026. All text is our own summary. Sources that are
CC-BY-NC-ND (the 2023 control chart paper, the 2026 Copenhagen water
paper) are only summarized here, never quoted.

## Summary

1. **Strength (TDS) and extraction (EY) drive flavour separately, and
   ratio links them.** In the UC Davis drip-coffee studies, sourness rose
   with TDS and fell with EY. Bitterness rose with both. A "sweet"
   impression was strongest at low TDS and low-to-medium EY. Brew
   temperature at fixed TDS and EY made almost no difference. A sour cup
   can therefore come from a strong brew (fix: more water), not only from
   under-extraction (fix: finer grind). (Peer-reviewed.)
2. **There's no single "ideal" box.** Black-coffee drinkers fell into
   two preference groups. The larger one (57%) liked weak brews at about
   18% EY. The other liked either strong, low-EY fruity cups or
   high-EY roasty ones. Averaging everyone together lands near the
   classic ideal box, but that hides both groups. The app should learn
   each person's own spot from their ratings, not steer everyone to
   1.15–1.35% TDS and 18–22% EY. (Peer-reviewed; one population of young
   Californians.)
3. **In immersion, ratio sets strength and barely moves extraction.**
   At equilibrium, TDS scaled with the inverse of the brew ratio while EY
   stayed at about 21% across ratios. Grind, roast and temperature
   (80–99 °C) changed it little. For French press, steeped brews or a
   Clever, ratio is the strength dial and grind mostly changes how fast
   you reach equilibrium. (Peer-reviewed.)
4. **Alkalinity (bicarbonate/KH) matters more than hardness (GH).** In
   trained-panel tests, calcium up to about 264 mg/L couldn't be told
   apart from pure water. Bicarbonate cut acidity and fruit and added
   bitter and roasted notes, and tasters could detect it from 120 mg/L.
   Experiments and reviews also find hardness between about 20 and
   250 ppm as CaCO3 has little effect on extraction. When a filter cup
   tastes flat, high alkalinity should be suspected before grind.
   (Peer-reviewed plus expert review.)
5. **Espresso tolerates far more alkalinity than filter.** Each gram of
   coffee meets about a tenth as much water, so the same water buffers
   far less of its acid. Water advice should depend on the method.
   (Expert review, ZHAW.)
6. **Whole beans degas over weeks, and most of it goes at grinding.**
   ZHAW measured degassing over more than four weeks. Darker and faster
   roasts degassed faster. Fresh coffee lost up to 75% of its trapped
   gas in the first 90 seconds after grinding. Light roasts hold less gas
   but release it more slowly. (Peer-reviewed.)
7. **Rest windows are expert opinion, and they vary a lot.** Rao
   suggests about a day for dark roasts, a day or two for classic drum
   roasts, and one to four weeks for light air roasts. A self-published
   blind cupping of 21 coffees found most kept improving past day 8. No
   peer-reviewed study we found measures EY against roast age. Roast age
   should be treated as a modifier ("very fresh light roast: expect
   lower extraction and more sourness"), not a rule.
8. **Freezing nearly stops the clock if the beans stay dry.** By an
   Arrhenius estimate, a freezer slows degassing about 12.5×. Frozen dark
   roasts smelled close to fresh after 9 weeks, while the room-temperature
   ones stood out. The main risk is condensation: let a sealed portion
   warm fully before opening it. (Peer-reviewed plus a lecture.)
9. **Cold beans grind differently.** Beans at freezer temperature gave
   a narrower size distribution and a smaller mode. Another study at the
   same setting found an unchanged distribution but faster espresso
   flow. When someone starts grinding from frozen, the grind setting may
   need a nudge. The direction isn't settled (see Disagreements).
10. **Storage after opening matters.** In opened bags, oxygen climbed
    above 10% within about two weeks. Clips, tape and moving the beans to
    another container all staled faster than an integrated screw-cap
    pack. Roast age alone understates staling for an opened bag kept at
    room temperature.

---

## Strength, extraction and the control chart

### The 2023 control charts replace the "ideal" box with attribute directions

- **Finding:** UC Davis combined three earlier studies into new charts.
  A Sensory chart shows where attributes peak. Acid/sour, citrus and red
  fruit peak at high TDS and low EY. Bitterness, astringency and roasted
  notes peak at high TDS and high EY. "Sweet" peaks at low TDS. A
  Consumer chart shows two preference groups, and a streamlined chart
  relabels Lockhart's box as the "classic standard" rather than
  "ideal". The authors call "sweet" a flavour impression from aromatics
  and the absence of bitterness, since sugars in brewed coffee sit below
  taste threshold.
- **Evidence:** peer-reviewed synthesis. It draws on 54 drip brews in two
  3×3×3 designs (TDS 1.0/1.25/1.5%, EY 16/20/24%, three roasts or three
  temperatures), with trained panels rating 30–33 attributes, plus
  consumer liking. In total that's 32,076 descriptive and 3,186 liking
  measurements. Drip brewer only.
- **Source:** Guinard, Frost, Batali, Cotter, Lim, Ristenpart, "A new
  Coffee Brewing Control Chart relating sensory properties and consumer
  liking to brew strength, extraction yield, and brew ratio", *J. Food
  Sci.* 88(5):2168–2177, 2023. https://doi.org/10.1111/1750-3841.16531
  (CC BY-NC-ND: summary only).
- **Lever:** ratio and grind (through TDS and EY); drip/percolation.
- **For the app:** prompt rule plus Insight. Map tasting notes to a
  direction on the chart:
  - sour or fruity-sharp with high TDS → lower TDS (more water);
  - sour with low EY → raise EY (finer, or longer contact);
  - bitter/astringent with high TDS and high EY → lower both;
  - "flat but heavy" → high TDS and high EY.

  For the Insight, plot each brew's TDS against EY with ratio diagonals,
  coloured by rating.

### Sourness follows TDS, and EY lowers it

- **Finding:** Across the same brew grid, titratable acidity (TA) rose
  in a strong straight line with TDS. It barely changed with EY, and pH
  hardly tracked either. Perceived sourness rose with TDS and fell with
  EY. TA predicted sourness better than pH did, for trained panels and
  for consumers. Consumers more often rated high-TA cups "too acidic",
  though one consumer group preferred more acidity.
- **Evidence:** peer-reviewed. Drip brews at three TDS × three EY levels,
  three roasts and three temperatures, with descriptive and consumer
  panels. We verified this from the authors' ASIC 2021 poster.
- **Source:** Batali, Cotter, Frost, Ristenpart, Guinard, "Titratable
  acidity, perceived sourness, and liking of acidity in drip brewed
  coffee", *ACS Food Sci. Technol.* 1(4):559–569, 2021.
  https://doi.org/10.1021/acsfoodscitech.0c00078. Poster:
  https://alphavisa.com/asic/2021/documents/eposters/S8-P-03_5067_BATALI.pdf
- **Lever:** ratio first, then grind; drip.
- **For the app:** prompt rule. When a brew is "sour" and its TDS is at
  or above the person's usual, suggest a longer ratio (for example 1:15
  → 1:16.5) before going finer. Grind is the first lever only when EY is
  low (below about 18%) or TDS is already low. This rule is the main gap
  behind the AI "rarely changing the ratio".

### Two consumer preference groups, not one ideal

- **Finding:** 118 mostly college-age black-coffee drinkers rated 27
  brews spanning the chart, and cluster analysis split them in two. The
  larger group (57%) had dome-shaped liking that peaked at low TDS and
  about 18% EY. Its likes mirrored its dislike of bitterness and
  sourness. The smaller group (43%) had saddle-shaped liking with two
  peaks: low EY at medium-to-high TDS (acidic, fruity), and high EY at
  medium TDS (roasted, thick, black tea). Preferences varied most with
  TDS. Overall flavour intensity and acidity drove liking.
- **Evidence:** peer-reviewed. n = 118, 9-point hedonic scale, external
  preference mapping. One population; the authors expect other
  populations to split differently.
- **Source:** Cotter, Batali, Ristenpart, Guinard, "Consumer preferences
  for black coffee are spread over a wide range of brew strengths and
  extraction yields", *J. Food Sci.* 86(1):194–205, 2021.
  https://doi.org/10.1111/1750-3841.15561. The cluster shares and peaks
  come from the 2023 synthesis above. Data:
  https://datadryad.org/dataset/doi:10.25338/B8993H
- **Lever:** ratio (TDS) and grind (EY); drip.
- **For the app:** Insight plus prompt rule. Show rating against TDS and
  against ratio for the person's own brews, and let the AI read where
  their best-rated brews sit. If they sit low and weak, the AI shouldn't
  push them back to 1.3% TDS. Don't assume the classic box is the
  target.

### Brew temperature barely matters once TDS and EY are fixed

- **Finding:** Drip brews made at 87, 90 and 93 °C were adjusted to hit
  the same TDS and EY targets (using grind size and brew time). Their
  sensory profiles were essentially the same, and TDS and EY drove the
  differences. Temperature changes how fast you reach a given extraction,
  not where you end up.
- **Evidence:** peer-reviewed. 27 drip brews, trained descriptive panel,
  33 attributes.
- **Source:** Batali, Ristenpart, Guinard, "Brew temperature, at fixed
  brew strength and extraction, has little impact on the sensory profile
  of drip brew coffee", *Sci. Rep.* 10:16450, 2020.
  https://doi.org/10.1038/s41598-020-73341-4
- **Lever:** temperature, ratio, grind; drip, 87–93 °C.
- **For the app:** prompt rule. When a brew has TDS and EY recorded,
  reason from those first and treat a temperature change as a way to
  move EY, not as a flavour lever of its own. (See
  `temperature-roast-solubility.md` for when temperature is the right
  way to move EY.)

### Roast level shifts where attributes sit, but the TDS/EY trends hold

- **Finding:** The first of the three studies crossed the TDS × EY grid
  with light, medium and dark roasts. At medium roast, bitterness and
  ashy notes rose with both TDS and EY. Sourness rose with TDS and fell
  with EY. Sweetness fell with both. Dark-chocolate notes rose with EY at
  lower TDS for some roasts. The SCA summary also notes that the old
  "strong/weak" labels mislead, because attributes like sweetness
  increase as TDS falls.
- **Evidence:** peer-reviewed. 27 brews, 12 trained panelists in
  triplicate, 30 attributes.
- **Source:** Frost, Ristenpart, Guinard, "Effects of brew strength,
  brew yield, and roast on the sensory quality of drip brewed coffee",
  *J. Food Sci.* 85(8), 2020. https://doi.org/10.1111/1750-3841.15326.
  SCA summary: Frost, Batali, Guinard, Ristenpart, "Towards a New
  Brewing Chart", *25 Magazine* issue 13 (year not shown on page),
  https://sca.coffee/sca-news/25/issue-13/towards-a-new-brewing-chart-xpj8t
- **Lever:** ratio and grind; all roasts, drip.
- **For the app:** prompt rule. The TDS/EY direction rules above apply
  at every roast level. Roast changes which notes appear, not the
  direction of the fix.

### In immersion, ratio controls TDS and EY stays near 21%

- **Finding:** A desorption model and full-immersion experiments showed
  TDS roughly inversely proportional to brew ratio. Equilibrium EY stayed
  independent of ratio, at about 21% (regression 21.5 ± 0.2%). The
  equilibrium constant barely changed between 80 and 99 °C or with
  roast. Finer grinds raised TDS and EY only slightly (EY spread within
  about 4 points, roughly 19–23%). TDS plateaued after about 20 minutes
  at normal ratios. The authors also show oven-dried EY understates true
  equilibrium EY, because liquid held in the spent grounds is lost (they
  measured about 2.5 g retained per gram of coffee).
- **Evidence:** peer-reviewed. 1 L equilibrium brews at ratios 3–25,
  cupping-style brews at 12–21, and 300 mL time-series brews. CC BY 4.0.
- **Source:** Liang, Chan, Ristenpart, "An equilibrium desorption model
  for the strength and extraction yield of full immersion brewed
  coffee", *Sci. Rep.* 11:6904, 2021.
  https://doi.org/10.1038/s41598-021-85787-1
- **Lever:** ratio; immersion (French press, cupping, Clever, cold
  steeps), after contact long enough to reach equilibrium.
- **For the app:** prompt rule. For immersion methods, suggest ratio for
  strength complaints and don't expect grind to fix "weak". Grind
  mainly changes how fast extraction gets there, and the filtering. Only
  with short steeps does grind meaningfully raise EY.

### TDS, EY and ratio are tied by mass balance, and retained water matters

- **Finding:** The 2023 chart uses EY = TDS / (1 − TDS) × (R − R_abs),
  where R is the water-to-coffee ratio and R_abs (about 2.1) is the water
  held back in the wet grounds. Gagné shows that for percolation you
  should compute EY from the beverage weight and TDS. For immersion, use
  the water weight, because the retained liquid holds the same
  concentration as the cup. The 1/(1 − TDS) term adds about 0.2–0.5
  points. A dose scale reading to 0.1 g already adds about 0.1 points of
  error, so one decimal place is the most worth reporting.
- **Evidence:** peer-reviewed formula (Guinard 2023; Liang 2021). The
  method notes are expert, with worked derivations.
- **Source:** Guinard et al. 2023 (above). Gagné, "Measuring and
  Reporting Extraction Yields", *Coffee ad Astra*, 17 Feb 2019 (updated
  7 Apr 2019),
  https://coffeeadastra.com/2019/02/17/measuring-and-reporting-extraction-yields/
- **Lever:** ratio; all methods.
- **For the app:** Insight. When the app shows or computes EY from TDS,
  use the beverage yield for percolation and the water weight for
  immersion, and show one decimal. On the control-chart Insight, draw
  ratio diagonals with retained water included. Otherwise a brew
  "moves" on the chart just because the yield was measured differently.

## Water

### Bicarbonate, not hardness, changed the cup (2026 Copenhagen study)

- **Finding:** A Colombian medium roast was brewed with ultrapure water
  plus calcium, magnesium or bicarbonate, at levels inside and beyond
  the SCA range. Calcium at about 264 mg/L couldn't be told apart from
  the control on any attribute, and magnesium behaved alike. Bicarbonate
  at 300 mg/L sharply cut perceived acidity and fruitiness and raised
  bitter and roasted notes. Brew pH went from about 4.9 to 5.5, and even
  120 mg/L was detectable. Calcium plus bicarbonate had a milder effect,
  partly because calcium carbonate precipitated.
- **Evidence:** peer-reviewed. Ten trained panelists plus untrained
  screening tests; one coffee, one roast. EY wasn't measured. We read
  this from trade-press coverage plus Crossref metadata, not the full
  text.
- **Source:** Rune, Steen, Kjærgaard, Maroun, Bredie, Kjaergaard,
  "Impact of Water Composition on Coffee Sensory Properties: A
  Comprehensive Analysis", *J. Food Sci.* 91, e71434, 2026.
  https://doi.org/10.1111/1750-3841.71434 (CC BY-NC-ND: summary only).
  Coverage: Patel, *Barista Magazine Online*, 10 Nov 2026,
  https://www.baristamagazine.com/salt-of-the-earth-soul-of-the-cup-why-bicarbonate-not-hardness-runs-your-brew-water/
- **Lever:** water; filter-style brew, medium roast.
- **For the app:** prompt rule. When a brew has a water profile and the
  complaint is flat, dull or muted acidity, check bicarbonate/KH before
  suggesting finer or hotter. Above about 100 mg/L bicarbonate (roughly
  80 ppm as CaCO3, or KH about 4.6 °dH), suggest softer or blended water
  first. Don't blame GH for flavour on its own.

### Alkalinity sets perceived acidity, and espresso tolerates about 10× more

- **Finding:** Perceived acidity depends on the acid extracted minus
  what the water's alkalinity neutralizes. At near-neutral pH (6–8) with
  alkalinity above about 20 ppm as CaCO3, alkalinity matters far more
  than pH. Espresso brings roughly ten times less water per gram of
  coffee, so the same water buffers much less of its acid. Wellinger
  proposes an espresso zone allowing alkalinity up to about 150 ppm and
  hardness down to about 20 ppm, both as CaCO3. Hardness between about
  20 and 250 ppm had little measured effect on extraction efficiency,
  despite anecdotes of over-extraction at high hardness and
  under-extraction at low.
- **Evidence:** expert review by a ZHAW researcher, drawing on lab work.
  No new data in the article itself.
- **Source:** Wellinger, "Water and Coffee Acidity: How to Adapt Your
  Water for Different Extraction Methods", *25 Magazine* issue 9, SCA
  (year not shown on page),
  https://sca.coffee/sca-news/25/issue-9/english/water-and-coffee-acidity-how-to-adapt-your-water-for-different-extraction-methods-25-magazine-issue-9-pxjby
- **Lever:** water; method-dependent (filter vs espresso).
- **For the app:** prompt rule. Judge alkalinity against the method:
  the same KH can be too high for a light-roast V60 and fine for
  espresso. Prefer flagging alkalinity over flagging GH.

### Calcium and magnesium don't change how much acid is extracted

- **Finding:** CaCl₂ or MgCl₂ at 100 or 1000 ppm, added before or after
  brewing, gave little consistent change in four organic acids (citric,
  malic, lactic, quinic). At 100 ppm the effect was small or none. The
  authors conclude these acids extract regardless of water composition,
  and that any cation effect happens in the cup, or on less soluble
  compounds they didn't measure. This contradicts the 2014 modelling
  claim that magnesium-rich water extracts more (next entry).
  Bicarbonate was deliberately left out.
- **Evidence:** peer-reviewed. n = 5 per group, dark roast, 5-minute
  steep, GC-MS and NMR, no sensory panel. CC BY 4.0.
- **Source:** Bratthäll, Figueira, Nording, "Influence of divalent
  cations on the extraction of organic acids in coffee determined by
  GC-MS and NMR", *Heliyon* 10(5):e26625, 2024.
  https://doi.org/10.1016/j.heliyon.2024.e26625
- **Lever:** water; immersion, dark roast.
- **For the app:** prompt rule. Don't suggest "more magnesium" as a way
  to raise extraction. Treat GH as a minor taste and body factor.

### Computational chemistry: magnesium binds coffee compounds most strongly

- **Finding:** Modelled binding energies of Na⁺, Mg²⁺ and Ca²⁺ to coffee
  acids and flavour compounds suggested magnesium binds most strongly.
  The authors proposed Mg-rich water would extract more, that bicarbonate
  harms flavour, and that the balance of ions matters more than total
  TDS. This is the source of the popular "magnesium for extraction"
  idea.
- **Evidence:** peer-reviewed, computational only (no brewing
  experiment). The 2024 experimental study above disputes the
  extraction claim.
- **Source:** Hendon, Colonna-Dashwood, Colonna-Dashwood, "The Role of
  Dissolved Cations in Coffee Extraction", *J. Agric. Food Chem.*
  62(21):4947–4950, 2014. https://doi.org/10.1021/jf501687c. The
  practitioner version is Colonna-Dashwood and Hendon, *Water for
  Coffee* (2015; second edition 2025). We confirmed the book exists and
  its edition history from retailer listings, not its contents.
- **Lever:** water.
- **For the app:** none on its own. Record it as the origin of a claim
  that later experiments didn't support.

### SCA water targets and home recipes

- **Finding:** As tabulated by Gagné, the SCA brewing-water standard
  targets:

  | Parameter | Target | Acceptable range |
  |---|---|---|
  | Calcium hardness | 68 ppm as CaCO3 | 17–85 |
  | Alkalinity | about 40 ppm as CaCO3 | narrow |
  | pH | 7 | 6.5–7.5 |
  | Sodium | about 10 mg/L | — |
  | TDS | 150 mg/L | 75–250 |

  The water should also be free of chlorine and odour. In his blind
  tests, Gagné preferred a Rao/Perger mineral recipe. He found Third Wave
  Water too acidic, and all his test waters beat his tap water. He's
  explicit that much of this rests on his own limited testing. He also
  notes that the claimed taste difference between magnesium and calcium
  hasn't been shown in a lab. (Ranges of 50–175 ppm hardness and 40–75
  ppm alkalinity circulate online, attributed to SCA cupping water or a
  2018 SCA handbook. We couldn't verify them in an SCA document.)
- **Evidence:** standard plus expert opinion and informal blind tests.
- **Source:** Gagné, "Water for Coffee Extraction", *Coffee ad Astra*,
  16 Dec 2018 (updated 2019),
  https://www.coffeeadastra.com/2018/12/16/water-for-coffee-extraction/
- **Lever:** water; filter.
- **For the app:** prompt rule plus new suggestion output. Compare the
  recorded profile to these targets. Above all, look at alkalinity near
  40 ppm as CaCO3 for filter. Allow a "water" suggestion (such as
  "dilute with distilled 1:1" or "use a 40 ppm-alkalinity recipe") when
  the profile is far off and the complaint fits. Unit conversions are
  plain molar-mass arithmetic: 1 °dH = 17.8 ppm as CaCO3, and mg/L
  HCO3⁻ × 0.82 = ppm alkalinity as CaCO3.

### Blind cupping: calcium accents acidity, bicarbonate mutes it

- **Finding:** In Royal Coffee's double-blind round (one Mexican coffee,
  five cuppers), calcium-led water emphasized acidity. Magnesium-led
  water tasted sweeter and rounder, but its "ideal" recipe was called
  flat by three of five tasters. Bicarbonate-only and hard water had the
  lowest acidity, and hard water tasted thick and muddy. Distilled water
  scored highest overall, narrowly ahead of the calcium recipe. In an
  earlier non-blind round, bicarbonate muted acidity but did somewhat
  better on dark roasts.
- **Evidence:** controlled hobbyist/industry test. Five tasters, 0–5
  attribute scores, cupping only, imprecise TDS meter. Small n.
- **Source:** Kornman, "Treading Water: A Practical H2O Guide for Coffee
  Professionals, Part II: The Sensory Data", Royal Coffee, 5 Sep 2018
  (first published in Daily Coffee News, 29 Aug 2018),
  https://royalcoffee.com/treading-water-a-practical-h2o-guide-for-coffee-professionals-part-ii-the-sensory-data/
- **Lever:** water; cupping (immersion); roast-dependent.
- **For the app:** prompt rule (weak evidence). High bicarbonate is more
  acceptable for dark roasts than light. Very soft water isn't
  automatically bad.

## Rest and degassing

### Whole beans degas over weeks, and grinding releases most of the gas

- **Finding:** A time-resolved weighing method tracked gas release from
  roasted coffee for over four weeks. Whole-bean degassing fitted
  Weibull time constants of about 150–380 hours (roughly 6–16 days).
  Darker roasts degassed faster, and faster roasts degassed faster at
  medium and dark roast (not at light). For freshly roasted coffee, up to
  75% of the trapped gas left during and within 90 seconds of grinding.
  Total gas released rose from light to medium roast, then levelled off.
  CO2 is also formed during brewing when coffee acids meet bicarbonate in
  the water.
- **Evidence:** peer-reviewed. Arabica whole beans (nine samples) and
  ground Arabica and Robusta across roast degrees and speeds. ACS
  AuthorChoice (non-commercial).
- **Source:** Smrke, Wellinger, Suzuki, Balsiger, Opitz, Yeretzian,
  "Time-Resolved Gravimetric Method To Assess Degassing of Roasted
  Coffee", *J. Agric. Food Chem.* 66(21):5293–5300, 2018.
  https://doi.org/10.1021/acs.jafc.7b03310
- **Lever:** rest, bloom; light vs dark roast.
- **For the app:** prompt rule. Very fresh beans (under about 5 days,
  especially light ones) carry the most gas. When the person notes
  vigorous bloom, uneven drawdown or channeling at a low roast age,
  suggest a longer or more agitated bloom before a grind change.
  Darker roasts reach "rested" sooner.

### Freshness, freezing and condensation (Smrke's SCA lecture)

- **Finding:** Smrke compared degassing of beans kept 70 days in a
  domestic freezer with fresh beans. By an Arrhenius estimate, freezing
  slowed degassing about 12.5× compared with room temperature, so
  70 frozen days was about the same as two days at 35 °C. He cautioned
  that aroma loss may not scale the same way as CO2 loss. His other
  points:
  - Let frozen beans warm fully before opening (at least about an hour
    for 200 g) so moisture doesn't condense on them. Taking beans in and
    out of the freezer had no measurable effect in his tests.
  - Dark roasts released about 1% of their weight as gas in a month,
    light roasts about 0.2–0.3%.
  - Espresso from very fresh coffee flowed faster, slightly older coffee
    slower, and very old coffee faster again, all at the same grind.
- **Evidence:** expert lecture presenting his group's data, partly
  preliminary. We read it through the SCA podcast page.
- **Source:** Smrke, "The Science of Coffee Freshness", SCA Expo
  Lectures, Boston, April 2019 (SCA Podcast #81),
  https://sca.coffee/sca-news/podcast/81/the-science-of-coffee-freshness-samo-smrke-expo-lectures-2019-6lrbe
- **Lever:** rest, storage; all roasts.
- **For the app:** prompt rule. Compute an "effective age" as roast age
  minus days frozen, counting frozen days as nearly zero. Advise on
  effective age, not calendar age. When a frozen portion was used,
  mention letting it warm sealed if the person reports clumping or
  dampness.

### Opened bags stale faster, and how you reclose them matters

- **Finding:** Whole beans were rested 3 weeks in valve bags, then
  opened and stored four ways: an airtight canister, the bag taped, the
  bag clipped, or a pack with an integrated screw cap. Their aroma was
  followed by GC-MS. The screw-cap pack kept freshness best, and the
  other three staled faster. Oxygen inside opened packs rose above 10%
  within about two weeks. A key fresh-aroma compound (methanethiol) fell
  to about 15% of its starting level within eight weeks in opened packs.
  The 2-butanone/2-methylfuran ratio was the best staling index.
- **Evidence:** peer-reviewed. Chemistry only (the authors say sensory
  thresholds still need testing). Tchibo co-funded. CC BY 4.0.
- **Source:** Smrke, Adam, Mühlemann, Lantz, Yeretzian, "Effects of
  different coffee storage methods on coffee freshness after opening of
  packages", *Food Packaging and Shelf Life* 33:100893, 2022.
  https://doi.org/10.1016/j.fpsl.2022.100893
- **Lever:** rest/storage.
- **For the app:** prompt rule (weak). For an opened bag at room
  temperature, from about 3 weeks after opening expect fading aroma and
  less bloom. Suggest freezing excess beans rather than chasing staling
  with grind changes.

### Rest needs depend on roast degree and roaster type

- **Finding:** Rao argues there's no universal rest. Very fresh espresso
  gives heavy crema and lower extraction, which he puts down to gas back
  pressure and gas slowing wetting. Filter suffers less, because gas
  escapes into the air. His suggested rests: dark, oily roasts no more
  than about a day; classic drum roasts a day or two; air-roasted light
  coffee one to four weeks. Cold, vacuum-sealed or pressurized storage
  slows ageing. He hedges throughout and reports no measurements.
- **Evidence:** expert opinion, from his own roasting and reader
  reports.
- **Source:** Rao, "Resting Roasts: Is Fresher Better?", scottrao.com,
  29 May 2023, https://www.scottrao.com/blog/restingbeans
- **Lever:** rest; method (espresso > filter), roast level, roaster type.
- **For the app:** prompt rule. At low effective age, a very light roast
  for espresso that tastes sour or thin with fast or uneven flow may
  just need more days. Mention this before a big grind change. Don't
  apply that caution to dark roasts.

### Blind cupping: most coffees kept improving well past day 8

- **Finding:** 21 coffees from five countries and eight processes were
  roasted alike and cupped double-blind at days 1, 4, 8, 11, 17 and 22.
  Only one peaked at 24 hours, and one was still improving at day 22.
  Washed coffees changed least, naturals and honeys most. The report's
  own summary figures contradict each other: the abstract says most
  peaked by 72 hours, the discussion says most peaked at day 8 or later.
- **Evidence:** controlled hobbyist/industry test. Double-blind SCA
  cupping with at least three cuppers including a Q Grader, 50 g Ikawa
  roasts. Self-published, not peer-reviewed.
- **Source:** Girard, Stazzone, "How Long Should Coffee Rest (Post
  Roast) Before Industry Professionals Assess Quality?", Cafe Kreyol,
  v1.0, 13 Jun 2022, https://cafekreyol.com/research/post-roast-rest-study/
- **Lever:** rest; processing method; cupping (immersion).
- **For the app:** Insight. Plot rating against effective roast age per
  bean, with processing method shown. The person's own curve is better
  evidence than any fixed window.

### Wang & Lim: roast colour predicts CO2 content

- **Finding:** Darker roast colour went with more residual CO2, and
  faster, hotter roasts degassed faster.
- **Evidence:** peer-reviewed (we read the abstract only).
- **Source:** Wang, Lim, "Effect of roasting conditions on carbon
  dioxide degassing behavior in coffee", *Food Res. Int.* 61:144–151,
  2014. https://doi.org/10.1016/j.foodres.2014.01.027
- **Lever:** rest; roast level.
- **For the app:** none beyond the Smrke rule. It supports "darker
  roasts degas sooner".

## Freezing and cold storage

### Frozen beans keep their aroma, especially dark roasts

- **Finding:** Six roasts from City to Vienna were stored 9 weeks either
  in a −18 °C chest freezer or at room temperature, then compared with
  freshly roasted coffee. In a sorting task, room-temperature dark roasts
  stood apart while frozen dark roasts sat close to fresh. Light roasts
  showed little difference whichever way they were stored, matching
  smaller chemical losses.
- **Evidence:** peer-reviewed. 48 consumers, projective mapping of
  aroma from grounds, plus HS-SPME-GC-MS. Aroma only, not brewed taste.
- **Source:** Cotter, Hopfer, "The Effects of Storage Temperature on the
  Aroma of Whole Bean Arabica Coffee Evaluated by Coffee Consumers and
  HS-SPME-GC-MS", *Beverages* 4(3):68, 2018.
  https://doi.org/10.3390/beverages4030068. Design and results as
  reported by Penn State News, 15 Jan 2019,
  https://www.psu.edu/news/research/story/wake-and-smell-coffee-research-shows-freezing-beans-can-preserve-aroma
- **Lever:** storage; dark roasts benefit most.
- **For the app:** prompt rule. Weight days at room temperature more
  heavily for dark roasts than for light. A dark roast more than about
  4 weeks unfrozen is a likelier cause of "flat/stale" notes than the
  grind.

### Refrigerated beans changed less than room-temperature ones

- **Finding:** Beans opened a month after roasting, then kept a further
  month at 5 °C rather than 20 °C, showed smaller volatile changes. Cold
  brews from refrigerated beans stayed closer to fresh, while espresso
  profiles changed little with storage temperature. Sourness rose with
  storage either way. No freezer condition was tested, and the paper's
  text and tables disagree in places.
- **Evidence:** peer-reviewed. Arabica, Robusta and a blend; trained
  panel (n not stated); GC-MS. CC BY 4.0.
- **Source:** Gantner, Kostyra, Górska-Horczyczak, Piotrowska, "Effect
  of Temperature and Storage on Coffee's Volatile Compound Profile and
  Sensory Characteristics", *Foods* 13(24):3995, 2024.
  https://doi.org/10.3390/foods13243995
- **Lever:** storage.
- **For the app:** none directly (we record frozen days, not fridge
  days). It supports "colder storage = slower ageing".

### Colder beans grind narrower and finer

- **Finding:** Beans chilled to 20, −19, −79 and −196 °C were ground on
  an EK43. Colder beans gave a narrower particle size distribution, with
  a mode about 31% smaller from room temperature to −196 °C. The biggest
  change came between room temperature and freezer temperature. Origin
  and processing (washed or natural) didn't change the distribution.
  Beans frozen and then warmed back up ground like unfrozen ones. The
  authors suggest dry frozen storage is chemically reasonable.
- **Evidence:** peer-reviewed. Laser diffraction, no brewing or
  extraction test. CC BY 4.0.
- **Source:** Uman, Colonna-Dashwood, Colonna-Dashwood, Perger, Klatt,
  Leighton, Miller, Butler, Melot, Speirs, Hendon, "The effect of bean
  origin and temperature on grinding roasted coffee", *Sci. Rep.*
  6:24483, 2016. https://doi.org/10.1038/srep24483
- **Lever:** grind and storage; flat-burr grinder.
- **For the app:** prompt rule. When a brew used frozen beans ground
  cold and the person's last brews didn't, expect a finer effective
  grind and higher extraction at the same setting. Suggest coarsening
  slightly (flat burrs) rather than changing ratio.

### Beans cooled to −17 °C: same distribution, faster espresso flow

- **Finding:** Medium-roast beans were chilled to about −17 °C (or
  heated to about 87 °C) just before grinding on an E65S. At the same
  setting, they showed no substantial change in particle size
  distribution, but espresso flowed significantly faster. Cold beans
  needed only a small grind change to reach about 1 mL/s. At matched
  flow, TDS was similar across treatments, but cold beans extracted less
  caffeine and some aroma compounds. Heating looked like accelerated
  ageing.
- **Evidence:** peer-reviewed. One commercial blend; laser diffraction,
  HPLC, GC-MS; no sensory panel. CC BY 4.0.
- **Source:** Pignatone, Angeloni, Spadi, Corti, Calamai, Innocenti,
  Bellumori, Parenti, Masella, "Effects of Coffee Bean Thermal
  Treatments on Particle Size Distribution and Espresso Bioactive
  Compounds", *Appl. Sci.* 16(10):4886, 2026.
  https://doi.org/10.3390/app16104886
- **Lever:** grind; espresso.
- **For the app:** prompt rule (tentative). For espresso from frozen
  beans, expect the flow to differ from room-temperature beans. Watch
  the shot time and adjust grind from that, without assuming a
  direction. This conflicts with Uman et al. (see Disagreements).

### Hendon: vacuum-seal, keep water vapour out, grind cold for repeatability

- **Finding:** Hendon advises keeping air (and with it water vapour) off
  roasted coffee, ideally by vacuum sealing, because freezers are humid
  and poorly sealed coffee takes up odours. He describes cold grinding
  as a way to get a consistent, more uniform amount of fines, allowing
  higher extraction with fewer mixed flavours. As a rule of thumb, most
  staling reactions roughly halve in rate for every 10 °C drop.
- **Evidence:** expert opinion (interview), informed by his 2016 study.
- **Source:** Tomlinson, "Cryogenics & the Benefits of Freezing Green
  and Roasted Coffee: Interview with Christopher H. Hendon", *The Little
  Black Coffee Cup*, 22 May 2017,
  https://www.thelittleblackcoffeecup.com/journal/cryogenics
- **Lever:** storage, grind.
- **For the app:** prompt rule. When days frozen > 0 and the person
  reports off or freezer-like aromas, suggest airtight single-dose
  portions rather than brew changes.

---

## Disagreements and open questions

- **Ratio vs grind when a cup is sour.** The UC Davis data say sourness
  tracks TDS and falls with EY, so a strong brew can taste sour at a
  normal EY. Common barista practice (and the current AI) treats sour as
  under-extracted and reaches for a finer grind. Both can be true: the
  fix depends on where the brew sits on the chart. Without TDS, the app
  can only infer strength from the ratio and the tasting notes.
- **Does more water raise EY in percolation?** The mass balance says EY
  rises with ratio at fixed TDS. In immersion, Liang et al. found EY
  independent of ratio at equilibrium. For pour-over, the common view
  that a longer ratio raises EY as well as lowering TDS is plausible, but
  we didn't find a controlled study measuring it. Lance Hedrick's 2026
  ratio video tests this, but we couldn't verify its content (see
  Sources).
- **Magnesium and extraction.** Hendon et al. 2014 (computational) say
  Mg-rich water extracts more. Bratthäll et al. 2024 (experimental) found
  Ca and Mg don't change acid extraction. Rune et al. 2026 found Ca and
  Mg barely changed taste. Kornman's cupping found Mg sweeter and
  rounder but sometimes flat. The weight of evidence is against "hardness
  drives extraction", but nobody has measured EY across GH with
  bicarbonate held constant.
- **Is distilled water bad?** Gagné and the SCA say some hardness is
  needed. In Kornman's blind round, distilled water scored highest. Small
  n, one coffee.
- **Grinding frozen beans.** Uman et al. 2016 (EK43) found narrower,
  finer distributions at freezer temperature. Pignatone et al. 2026
  (E65S, −17 °C) found the same distribution at the same setting but
  faster espresso flow. The difference may come from the grinder, the
  measurement or the thermal history. Whether frozen beans need a finer
  or coarser setting is open, and forum reports go both ways.
- **Rest windows.** Rao, Cafe Kreyol and roaster guides range from about
  a day (dark, drum) to about four weeks (light, air roaster). Cafe
  Kreyol's own summary contradicts itself. We found no peer-reviewed
  study of EY or sensory quality against roast age for filter or
  espresso. Smrke's anecdote (fast, then slow, then fast espresso flow
  as beans age) is unpublished.
- **Does CO2 lower extraction?** Rao and Smrke describe lower extraction
  and odd flow with very fresh espresso. The mechanism (back pressure, or
  gas blocking wetting) is proposed, not measured. For filter, a bloom
  is assumed to remove most of the effect.
- **Aroma vs CO2 under freezing.** Smrke's 12.5× figure is for
  degassing. He warns aroma compounds may age at a different rate.
  Cotter and Hopfer's aroma data support freezing for dark roasts over
  9 weeks, but there's no long-horizon (6–12 month) sensory study.
- **Generalizability of the consumer clusters.** Both preference groups
  come from one young Northern Californian population. The authors
  expect different splits elsewhere.

## Sources

Peer-reviewed

- Guinard, J.-X., Frost, S., Batali, M., Cotter, A., Lim, L.X.,
  Ristenpart, W.D. (2023). A new Coffee Brewing Control Chart relating
  sensory properties and consumer liking to brew strength, extraction
  yield, and brew ratio. *J. Food Sci.* 88(5):2168–2177.
  https://doi.org/10.1111/1750-3841.16531
- Cotter, A.R., Batali, M.E., Ristenpart, W.D., Guinard, J.-X. (2021).
  Consumer preferences for black coffee are spread over a wide range of
  brew strengths and extraction yields. *J. Food Sci.* 86(1):194–205.
  https://doi.org/10.1111/1750-3841.15561
- Frost, S.C., Ristenpart, W.D., Guinard, J.-X. (2020). Effects of brew
  strength, brew yield, and roast on the sensory quality of drip brewed
  coffee. *J. Food Sci.* 85(8). https://doi.org/10.1111/1750-3841.15326
- Batali, M.E., Ristenpart, W.D., Guinard, J.-X. (2020). Brew
  temperature, at fixed brew strength and extraction, has little impact
  on the sensory profile of drip brew coffee. *Sci. Rep.* 10:16450.
  https://doi.org/10.1038/s41598-020-73341-4
- Batali, M.E., Cotter, A.R., Frost, S.C., Ristenpart, W.D., Guinard,
  J.-X. (2021). Titratable acidity, perceived sourness, and liking of
  acidity in drip brewed coffee. *ACS Food Sci. Technol.* 1(4):559–569.
  https://doi.org/10.1021/acsfoodscitech.0c00078
- Liang, J., Chan, K.C., Ristenpart, W.D. (2021). An equilibrium
  desorption model for the strength and extraction yield of full
  immersion brewed coffee. *Sci. Rep.* 11:6904.
  https://doi.org/10.1038/s41598-021-85787-1
- Rune, C.J.B., Steen, I., Kjærgaard, E.R., Maroun, Z., Bredie, W.L.P.,
  Kjaergaard, H.G. (2026). Impact of Water Composition on Coffee Sensory
  Properties: A Comprehensive Analysis. *J. Food Sci.* 91:e71434.
  https://doi.org/10.1111/1750-3841.71434
- Bratthäll, T., Figueira, J., Nording, M.L. (2024). Influence of
  divalent cations on the extraction of organic acids in coffee
  determined by GC-MS and NMR. *Heliyon* 10(5):e26625.
  https://doi.org/10.1016/j.heliyon.2024.e26625
- Hendon, C.H., Colonna-Dashwood, L., Colonna-Dashwood, M. (2014). The
  Role of Dissolved Cations in Coffee Extraction. *J. Agric. Food Chem.*
  62(21):4947–4950. https://doi.org/10.1021/jf501687c
- Smrke, S., Wellinger, M., Suzuki, T., Balsiger, F., Opitz, S.E.W.,
  Yeretzian, C. (2018). Time-Resolved Gravimetric Method To Assess
  Degassing of Roasted Coffee. *J. Agric. Food Chem.* 66(21):5293–5300.
  https://doi.org/10.1021/acs.jafc.7b03310
- Smrke, S., Adam, J., Mühlemann, S., Lantz, I., Yeretzian, C. (2022).
  Effects of different coffee storage methods on coffee freshness after
  opening of packages. *Food Packaging and Shelf Life* 33:100893.
  https://doi.org/10.1016/j.fpsl.2022.100893
- Wang, X., Lim, L.-T. (2014). Effect of roasting conditions on carbon
  dioxide degassing behavior in coffee. *Food Res. Int.* 61:144–151.
  https://doi.org/10.1016/j.foodres.2014.01.027
- Cotter, A.R., Hopfer, H. (2018). The Effects of Storage Temperature on
  the Aroma of Whole Bean Arabica Coffee Evaluated by Coffee Consumers
  and HS-SPME-GC-MS. *Beverages* 4(3):68.
  https://doi.org/10.3390/beverages4030068
- Gantner, M., Kostyra, E., Górska-Horczyczak, E., Piotrowska, A.
  (2024). Effect of Temperature and Storage on Coffee's Volatile
  Compound Profile and Sensory Characteristics. *Foods* 13(24):3995.
  https://doi.org/10.3390/foods13243995
- Uman, E., Colonna-Dashwood, M., Colonna-Dashwood, L., Perger, M.,
  Klatt, C., Leighton, S., Miller, B., Butler, K.T., Melot, B.C.,
  Speirs, R.W., Hendon, C.H. (2016). The effect of bean origin and
  temperature on grinding roasted coffee. *Sci. Rep.* 6:24483.
  https://doi.org/10.1038/srep24483
- Pignatone, M., Angeloni, G., Spadi, A., Corti, F., Calamai, L.,
  Innocenti, M., Bellumori, M., Parenti, A., Masella, P. (2026). Effects
  of Coffee Bean Thermal Treatments on Particle Size Distribution and
  Espresso Bioactive Compounds. *Appl. Sci.* 16(10):4886.
  https://doi.org/10.3390/app16104886

Expert, trade and hobbyist

- Frost, S., Batali, M., Guinard, J.-X., Ristenpart, W.D. Towards a New
  Brewing Chart. *25 Magazine* issue 13, SCA.
  https://sca.coffee/sca-news/25/issue-13/towards-a-new-brewing-chart-xpj8t
- Wellinger, M. Water and Coffee Acidity: How to Adapt Your Water for
  Different Extraction Methods. *25 Magazine* issue 9, SCA.
  https://sca.coffee/sca-news/25/issue-9/english/water-and-coffee-acidity-how-to-adapt-your-water-for-different-extraction-methods-25-magazine-issue-9-pxjby
- Smrke, S. (2019). The Science of Coffee Freshness. SCA Expo Lectures
  (SCA Podcast #81).
  https://sca.coffee/sca-news/podcast/81/the-science-of-coffee-freshness-samo-smrke-expo-lectures-2019-6lrbe
- Gagné, J. (2018). Water for Coffee Extraction. *Coffee ad Astra*.
  https://www.coffeeadastra.com/2018/12/16/water-for-coffee-extraction/
- Gagné, J. (2019). Measuring and Reporting Extraction Yields. *Coffee ad
  Astra*.
  https://coffeeadastra.com/2019/02/17/measuring-and-reporting-extraction-yields/
- Rao, S. (2023). Resting Roasts: Is Fresher Better?
  https://www.scottrao.com/blog/restingbeans
- Kornman, C. (2018). Treading Water, Part II: The Sensory Data. Royal
  Coffee.
  https://royalcoffee.com/treading-water-a-practical-h2o-guide-for-coffee-professionals-part-ii-the-sensory-data/
- Girard, E.W., Stazzone, J.C. (2022). How Long Should Coffee Rest (Post
  Roast) Before Industry Professionals Assess Quality? Cafe Kreyol.
  https://cafekreyol.com/research/post-roast-rest-study/
- Tomlinson, A. (2017). Interview with Christopher H. Hendon. *The Little
  Black Coffee Cup*. https://www.thelittleblackcoffeecup.com/journal/cryogenics
- Patel, B. (2026). How Bicarbonate, Not Water Hardness, May Be the Key
  to Better-Tasting Coffee. *Barista Magazine Online*.
  https://www.baristamagazine.com/salt-of-the-earth-soul-of-the-cup-why-bicarbonate-not-hardness-runs-your-brew-water/
- Colonna-Dashwood, M., Hendon, C.H. *Water for Coffee* (2015; 2nd ed.
  2025). Book; contents not reviewed.

Videos to review (unverified: we confirmed the title, channel and date,
but couldn't read the transcripts, so no claims above rest on them)

- Lance Hedrick, "The Water Ratio Mistake Ruining Your Coffee", 10 Apr
  2026, https://www.youtube.com/watch?v=9DDCHrHCc30. Part 3 of his
  variable-isolation series, on ratio.
- Lance Hedrick, "I Tested Every Brew Variable... Here's What Actually
  Matters", 17 Apr 2026, https://www.youtube.com/watch?v=yfb3AlDfu2Y
- Lance Hedrick, "This Will Change How You Store Coffee", 5 Sep 2026,
  https://www.youtube.com/watch?v=whwDZQALpsA. Its description cites
  Smrke 2018 and 2022, Uman 2016 and Gantner 2024.
- Lance Hedrick, "Knowing this will Change Everything! Ultimate Guide to
  Water for Coffee", 26 Mar 2025,
  https://www.youtube.com/watch?v=tiB6TpJRmOs. Chapters: GH vs KH 0:55,
  taste of cations 3:00, hard vs soft 5:53, tailoring water 9:53, taste
  test 15:25. Cites Bratthäll 2024 and Hendon 2014.
- James Hoffmann, "Should you freeze coffee beans?", 25 Mar 2020,
  https://www.youtube.com/watch?v=5uT5_IWWb00. Its description says
  freezing is broadly a great way to store excess coffee.
- James Hoffmann, "A Beginner's Guide to Resting Coffee", 29 Dec 2021,
  https://www.youtube.com/watch?v=_Py8JOi3REg
- James Hoffmann, "The Best Water for Coffee - An Introduction", 30 Dec
  2019, https://www.youtube.com/watch?v=jfElZfrmlRs; "Coffee Recipe
  Water Compared", 23 Jun 2021, https://www.youtube.com/watch?v=g-5p_H9WNpA

Not used: Barista Hustle articles on water buffer limits and CO2 in
espresso were paywalled (HTTP 402) and are left out.
