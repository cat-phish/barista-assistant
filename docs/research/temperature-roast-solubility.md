# Temperature, roast and solubility

How roast degree, roast weight loss, density, process, variety and bean age
change how a coffee extracts and what water temperature suits it; and how big
a lever temperature is next to grind, contact time and agitation. Cold blooms
and low-temperature techniques are in
[cold-bloom-low-temp.md](cold-bloom-low-temp.md); rest and freezing in depth
are in [strength-water-rest.md](strength-water-rest.md).

## Summary

1. **At matched strength and extraction, temperature barely changes the
   taste.** In the UC Davis drip study, 87, 90 and 93 °C brews tuned to the
   same TDS and extraction yield (EY) were essentially indistinguishable to a
   trained panel; TDS and EY drove the flavour (Batali 2020). Temperature
   matters mostly through *how much and how fast* it extracts.
2. **Temperature is a rate lever, not an endpoint lever (immersion).** Hotter
   water reached the final strength much faster, but the final EY was the
   same from 80 to 99 °C, and the same across light to extra-dark roasts
   (Liang 2021). In a time-limited brew (pour-over, espresso) faster means
   somewhat more extraction; in a long immersion it mostly doesn't.
3. **Next to grind, ratio and flow, temperature is a small lever.** In
   espresso, flow rate dominated and temperature (80–98 °C) only modulated it
   (Schmieder 2023). Hobbyist tests find a spread of only about 1.5 EY points
   across 84–96 °C in pour-over (Hedrick 2026, secondhand).
4. **Darker roasts are more porous but have less left to extract.** EY peaked
   around 12–14 % roast mass loss and fell for darker roasts at boiling water;
   very underdeveloped roasts (about 9–12 % loss) also extracted a little
   less (Lindsey 2024). A separate study found TDS *rising* with roast degree
   (Rao 2020), so "dark roasts are more soluble" is not settled.
5. **"Light = boiling, dark = cooler" is expert consensus with modest
   support.** Hoffmann, Gagné and Hedrick favour near-boiling kettles for
   light roasts, and Hedrick and Andueza find that hot water brings out roasty
   bitterness in darker coffees. But one roaster argues for 90–93 °C even for
   light roasts, and the controlled sensory data (one medium roast) shows
   little effect at all. Treat roast-based temperature as a sensible default,
   not a rule.
6. **Kettle temperature is not slurry temperature.** A pour-over slurry
   rarely gets above about 93 °C even with boiling water (Gagné), so a
   recipe's "93 °C kettle" brews several degrees cooler than its number
   suggests.
7. **Roast weight loss is the most useful roast number, but it isn't
   portable across processes.** At the same development time, naturals lost
   2–3 % more mass than washed coffees (Lindsey 2024).
8. **No good evidence ties altitude, density or variety to brew
   temperature.** These change roasting and probably grind behaviour, but no
   study found here measures their effect on the right brew temperature. The
   AI should not invent rules for them.
9. **Bean temperature changes grind, not origin or process.** Cold (frozen)
   beans grind finer and more evenly; origin and processing did not change
   the particle distribution (Uman 2016).
10. **For the app:** pick a temperature band from roast level and weight
    loss, move it in small steps only in response to taste (astringent or
    roasty-bitter → cooler; flat, sour or thin on a light roast → hotter),
    and fix strength or extraction problems with grind, ratio and time first.

## Findings

### Temperature has little sensory effect once TDS and EY are matched

- **Finding:** Drip coffee brewed at 87, 90 and 93 °C, with grind, ratio and
  pulsing adjusted to hit the same nine TDS/EY targets, showed no significant
  overall sensory difference by temperature; only one attribute (nutty)
  differed, by about one point on a 100-point scale. TDS was the strongest
  driver of flavour and EY a secondary one. The authors' summary: "surprisingly
  the brew temperature had no appreciable impact".
- **Evidence:** peer-reviewed. 12 trained panellists, 31 attributes, 27 sample
  types in triplicate, 270 brews; one washed Honduran medium roast (2:30
  development), one commercial batch drip brewer, served at 65 °C after about
  30 min. No chemistry measured. CC BY 4.0.
- **Source:** Batali, Ristenpart, Guinard, "Brew temperature, at fixed brew
  strength and extraction, has little impact on the sensory profile of drip
  brew coffee", *Scientific Reports* 10:16450, 2020,
  https://doi.org/10.1038/s41598-020-73341-4 (correction to the water recipe
  only: https://doi.org/10.1038/s41598-021-82505-9).
- **Lever:** temperature, 87–93 °C; drip/percolation; tested on a medium roast
  only.
- **For the app:** prompt rule. When the person's notes point at strength or
  extraction (weak, sour, bitter, harsh), the AI should change grind, ratio or
  time before temperature, and must not treat the recipe's temperature as the
  thing to "fix". Temperature changes are for a flavour tilt, not for
  correcting extraction.

### Consumers' liking follows strength, not brew temperature

- **Finding:** In the consumer arm of the same UC Davis project (118 regular
  black-coffee drinkers), liking depended mostly on TDS, splitting into a
  group preferring about 1.0 % and one preferring above 1.25 %; EY mattered
  mainly at high strength. Brew temperature (87–93 °C) at matched TDS and EY
  did not predict liking.
- **Evidence:** peer-reviewed work (Cotter et al. 2021, *J. Food Sci.*;
  Batali 2020) summarised by one of the authors in the SCA's magazine; the
  summary is what was read here.
- **Source:** Andrew Cotter, "How Hot is Hot Enough? Brew Temperature,
  Sensory Profile, and Consumer Acceptance of Brewed Coffee", *SCA News* 25,
  issue 15 (year not shown on the page, about 2021),
  https://sca.coffee/sca-news/25/issue-15/how-hot-is-hot-enough-brew-temperature-sensory-profile-and-consumer-acceptance-of-brewed-coffee-5dj5b
- **Lever:** ratio (strength), then temperature; drip.
- **For the app:** prompt rule and Insight. When a person's ratings track
  their measured TDS or ratio more than their temperature, the AI should say
  so and suggest a ratio change. Insight: rating vs TDS next to rating vs
  temperature, so the person sees which one actually moves their score.

### In immersion, hotter water is faster but not stronger in the end

- **Finding:** Full-immersion brews at 99 °C reached their final strength
  within about 20 minutes, while 94 and 80 °C took over 30 minutes; the final
  TDS and EY were the same across 80–99 °C (about 21 % EY). The equilibrium
  was also insensitive to grind and roast: four regular coffees from light to
  extra-dark (Agtron about 55 to 27) gave indistinguishable equilibrium TDS.
  The authors note this doesn't mean the brews taste the same.
- **Evidence:** peer-reviewed. Lab beaker immersions plus cupping; triplicate
  brews; five Peet's blends (the "light" was darker than a typical specialty
  light roast). CC BY 4.0.
- **Source:** Liang, Chan, Ristenpart, "An equilibrium desorption model for
  the strength and extraction yield of full immersion brewed coffee",
  *Scientific Reports* 11:6904, 2021,
  https://doi.org/10.1038/s41598-021-85787-1
- **Lever:** temperature (rate) and ratio (strength); full immersion (French
  press, cupping, long AeroPress steeps, Clever).
- **For the app:** prompt rule. For long immersions, the AI should treat
  temperature as a speed control: cooler water needs a longer steep to reach
  the same place, and changing temperature alone won't change strength much.
  Strength in immersion is set by ratio.

### Extraction yield peaks at light-to-medium roasts and falls for dark ones

- **Finding:** With boiling (100 °C) water in an inverted AeroPress, EY was
  highest for roasts with about 12–14 % roast mass loss and fell for darker
  roasts, even though bean porosity rose steadily with roast degree. For a
  washed Ethiopian, the two lightest, underdeveloped batches (8.9 % and 11.6 %
  loss) extracted slightly less than the medium one, which the authors put
  down to lower porosity slowing extraction. The natural coffee's EY spread
  (about 15–21 %) was wider than the washed one's (about 16–20 %).
- **Evidence:** peer-reviewed. Two Ethiopian lots (one natural, one washed,
  both grown at 1900–2200 m), five roast degrees each, sieved grounds, 1, 2
  and 10 min brews in triplicate (90 brews); refractometer, HPLC and SEM.
  The authors say the two lots were not chosen to test processing. CC BY 4.0.
- **Source:** Lindsey et al., "Caffeine content in filter coffee brews as a
  function of degree of roast and extraction yield", *Scientific Reports*
  14:29126, 2024, https://doi.org/10.1038/s41598-024-80385-3 (summary:
  https://phys.org/news/2024-12-scientists-roasting-affects-brew.html)
- **Lever:** roast (via weight loss); immersion/press at 100 °C.
- **For the app:** prompt rule. Expect lower attainable EY from dark roasts
  (roughly above 15–16 % weight loss) and don't push them hotter to chase
  extraction; for very light, underdeveloped roasts (about 12 % loss or
  less), more heat, finer grind or longer contact is the right direction.
  Present the thresholds as rough, since they come from two coffees.

### Natural and washed coffees lose different weight at the same roast

- **Finding:** Roasted on the same recipe and dropped at the same time after
  first crack, the washed coffee consistently lost 2–3 % less mass than the
  natural, with higher density and lighter colour, meaning it ended up
  systematically lighter.
- **Evidence:** peer-reviewed, two coffees (same study as above).
- **Source:** Lindsey et al. 2024 (as above), Experimental details and
  Results, https://doi.org/10.1038/s41598-024-80385-3
- **Lever:** roast; all methods.
- **For the app:** prompt rule. When both roast level and weight loss are
  recorded, the AI should read weight loss against the process (a natural at
  14 % is not as dark as a washed at 14 % would be) and say it's an
  approximation.

### Darker roasts are more porous, hold more gas and degas faster

- **Finding:** Measuring weight lost to degassing over 400+ hours, ZHAW found
  that darker roasts release gas faster and in larger total amounts, and that
  roast degree matters more than roast speed for whole beans; darker and
  faster roasts are more porous. Background figures they cite: roasting
  expands beans by up to 80 % and halves their density (about 1.3 to 0.7
  g/cm³ for a dark roast).
- **Evidence:** peer-reviewed; whole Arabica beans at three roast degrees and
  three roast speeds, plus ground Arabica and Robusta.
- **Source:** Smrke, Wellinger, Suzuki, Balsiger, Opitz, Yeretzian,
  "Time-Resolved Gravimetric Method To Assess Degassing of Roasted Coffee",
  *J. Agric. Food Chem.* 66:5293–5300, 2018,
  https://doi.org/10.1021/acs.jafc.7b03310 (author copy:
  https://digitalcollection.zhaw.ch/bitstream/11475/12175/2/2017_Smrke-etal_Roasted-coffe-degassing-time-resolved-gravimetry.pdf)
- **Lever:** rest; interacts with roast level.
- **For the app:** prompt rule. Days since roast should be read with roast
  level: a very fresh dark roast is gassy (expect a vigorous bloom), while a
  light roast stays dense and slow to extract for longer. Don't blame a fresh
  light roast's sourness on temperature alone.

### Another study found TDS rising with roast, and temperature mattering more for dark roasts

- **Finding:** Colombian beans at three roast degrees, brewed hot (100 °C
  initial water) and cold, gave higher TDS the darker the roast in both
  methods, and the hot–cold gap widened as roast got darker. The authors put
  the difference down to temperature-dependent solubility, especially of
  high-molecular-mass browning compounds (melanoidins).
- **Evidence:** peer-reviewed; three roasts, one origin; chemistry only (pH,
  titratable acidity, TDS, caffeine, CQAs, antioxidants), no sensory panel.
  CC BY 4.0.
- **Source:** Rao, Fuller, Grim, "Physiochemical Characteristics of Hot and
  Cold Brew Coffee Chemistry: The Effects of Roast Level and Brewing
  Temperature on Compound Extraction", *Foods* 9(7):902, 2020,
  https://doi.org/10.3390/foods9070902
- **Lever:** temperature × roast; hot vs cold immersion.
- **For the app:** none yet (it conflicts with Lindsey 2024; see
  Disagreements). Supports the general idea that darker roasts respond more
  to temperature, which fits the "cooler for darker" default.

### Brew temperature changes the colour of light and medium roasts more than dark

- **Finding:** At a fixed 2 % TDS, roast level had the biggest effect on brew
  colour; brew temperature (4, 22 and 92 °C) shifted the colour of light and
  medium roasts more than dark roasts, with hot brews darker and cold brews
  redder.
- **Evidence:** peer-reviewed; three origins × three roasts × three
  temperatures, 243 immersion brews; colour only, no taste. Licence is
  CC BY-NC-ND, so not quoted.
- **Source:** Yeager, Batali, Lim, Liang, Han, Thompson, Guinard, Ristenpart,
  "Roast level and brew temperature significantly affect the color of brewed
  coffee", *J. Food Sci.* 87(4):1837–1850, 2022,
  https://doi.org/10.1111/1750-3841.16089
- **Lever:** temperature × roast; immersion.
- **For the app:** none directly. A hint that temperature changes what light
  roasts extract more than it does for dark ones.

### In espresso, flow rate dominates and temperature only modulates it

- **Finding:** Across 80–98 °C, two grind settings and 1–3 mL/s flow, flow
  rate had the strongest effect on what ended up in the cup; finer grinds and
  hotter water made the flow effect stronger. All these influences were minor
  next to how much total beverage was pulled.
- **Evidence:** peer-reviewed; central composite design, ten fractions per
  shot, trigonelline, caffeine, 5-CQA and TDS; one coffee. CC BY 4.0.
- **Source:** Schmieder, Pannusch, Vannieuwenhuyse, Briesen, Minceva,
  "Influence of Flow Rate, Particle Size, and Temperature on Espresso
  Extraction Kinetics", *Foods* 12(15):2871, 2023,
  https://doi.org/10.3390/foods12152871
- **Lever:** time/ratio first, then grind, then temperature; espresso.
- **For the app:** prompt rule. For espresso, suggest yield (ratio) and grind
  before temperature, and keep temperature steps to 1–2 °C.

### Hot espresso brings out roasty and earthy notes

- **Finding:** Comparing 88, 92, 96 and 98 °C espresso, aroma and sensory
  flavour were the useful measures; 92 °C was best for the Arabica and the
  Robusta blend. For a dark sugar-roasted (torrefacto) Robusta blend, 88 °C
  scored well on overall liking, but the authors chose 92 °C because of more
  roasty and earthy/musty odorants and drinkers finding 88 °C not hot enough.
- **Evidence:** peer-reviewed; three coffees, headspace GC-MS plus a sensory
  panel. Only the abstract was read; later authors call some of its
  temperature correlations ambiguous (Schmieder 2023).
- **Source:** Andueza, Maeztu, Pascual, Ibáñez, de Peña, Cid, "Influence of
  extraction temperature on the final quality of espresso coffee", *J. Sci.
  Food Agric.* 83(3):240–248, 2003, https://doi.org/10.1002/jsfa.1304
- **Lever:** temperature; espresso; darker or Robusta coffees.
- **For the app:** prompt rule (weak). When a dark roast's notes say roasty,
  ashy, earthy or harsh, a cooler temperature is a reasonable suggestion.

### Roast level changes how strength and extraction taste

- **Finding:** One washed Arabica roasted light, medium and dark, each brewed
  to nine TDS/EY targets: seven attributes (burnt/ash, citrus, sour, bitter,
  sweet, body, finish) responded to TDS/EY at all three roasts, and sweetness
  fell as TDS rose regardless of roast. Other attributes responded only at
  some roasts.
- **Evidence:** peer-reviewed; trained descriptive panel, response surface
  design; abstract read only.
- **Source:** Frost, Ristenpart, Guinard, "Effects of brew strength, brew
  yield, and roast on the sensory quality of drip brewed coffee", *J. Food
  Sci.* 85(8):2530–2543, 2020, https://doi.org/10.1111/1750-3841.15326
- **Lever:** ratio and extraction, per roast level; drip.
- **For the app:** prompt rule. Strength and extraction advice applies at every
  roast level; the roast changes the target, not which lever to pull. "Not
  sweet" points to a weaker brew before a temperature change.

### The slurry is much cooler than the kettle, so start from boiling

- **Finding:** In a V60, the slurry rarely gets above about 93 °C even with
  boiling water, because the grounds, dripper and air absorb heat, and many
  small pours drop it well below 91 °C. Gagné therefore brews from 100 °C,
  sees no convincing evidence for the "use 99 °C" habit, and notes that
  temperature shifts which compounds extract fastest (so it does change the
  profile). He doesn't think hot water "burns" coffee, given roasting is far
  hotter.
- **Evidence:** expert opinion with measurements (astrophysicist, author of
  *The Physics of Filter Coffee*).
- **Source:** Jonathan Gagné, "How to Brew Better Coffee with a V60", Coffee
  ad Astra, 30 Nov 2018, §4.6 Brew temperature,
  https://coffeeadastra.com/2018/11/30/brewing-better-coffee/
- **Lever:** temperature; pour-over, brewer material and pour count.
- **For the app:** prompt rule. The AI should talk about the kettle and the
  slurry separately, and expect heat loss from ceramic or glass brewers and
  many small pulses. Cooling the kettle by 2 °C on a pulse-heavy recipe can
  mean a much cooler slurry.

### Hoffmann's kettle and slurry guide by roast

- **Finding:** Hoffmann argues for brewing with boiling water and gives
  guidance that goes cooler as roast gets darker: light 100 °C kettle (about
  93 °C slurry), medium 98 °C+ (about 90 °C+), dark 90 °C (about 85 °C+). He
  calls it guidance that will vary.
- **Evidence:** expert opinion (video, with the table in its description).
- **Source:** James Hoffmann, "Brew your coffee with boiling water - coffee
  brewing temperatures explained.", YouTube, 3 Mar 2020,
  https://www.youtube.com/watch?v=K_r5kpXPRYo (table in the description;
  thermometer section from 2:31).
- **Lever:** temperature by roast; pour-over and immersion.
- **For the app:** prompt rule. Use these as the roast-level starting bands
  when there are no earlier brews to learn from.

### Hedrick: hotter suits lighter coffees, darker ones turn harsh

- **Finding:** In his testing before the video, Hedrick found 95 °C and above
  consistently gave better cups with lighter coffees (aromatics, balance), with
  a slight astringency, and that the darker the roast, the more negative
  attributes showed up at higher temperatures. He relays views from Samo
  Smrke (ZHAW) from private messages about an unpublished study with
  Simonelli.
- **Evidence:** controlled hobbyist test, number of coffees not stated; the
  Smrke part is unpublished and **unverified**.
- **Source:** Lance Hedrick, "DOES BREW TEMPERATURE ACTUALLY MATTER?",
  YouTube, 6 Feb 2023, https://www.youtube.com/watch?v=pZ-hKmz4PIY (findings
  in the video description; no transcript checked, so no timestamp).
- **Lever:** temperature by roast; pour-over.
- **For the app:** prompt rule. For light roasts, a hotter kettle (95 °C+) is
  the default; if the person notes dryness or astringency, try finer-but-cooler
  or a slightly coarser grind before dropping far. For darker roasts, notes of
  bitterness or harshness are a reason to go cooler.

### Hedrick: one coffee across 84–96 °C

- **Finding:** Brewing one coffee identically from 84 to 96 °C, the hottest
  brew was more complex but had roasty, caramelised bitterness; 90 and 93 °C
  were favourites, 87 °C was good, and 84 °C was dull and less aromatic. EY
  fell by only about 1.5 percentage points from hottest to coolest, and brew
  times didn't change steadily.
- **Evidence:** controlled hobbyist test, one coffee, one taster, not blind;
  he presents it as an example, not a rule. The numbers come from a
  third-party summary and were **not checked against the video**.
- **Source:** Lance Hedrick, "How Brewing Temperature Affects Coffee Taste",
  YouTube, 27 Mar 2026, https://www.youtube.com/watch?v=SsZHPcQcGIw (tasting
  5:54, results 9:08, data 11:21, from the video's chapters); summary at
  https://youtubesummary.com/summary/SsZHPcQcGIw
- **Lever:** temperature; pour-over.
- **For the app:** prompt rule. A temperature change of a few degrees moves EY
  by well under a point; the AI should present it as a flavour tweak and not
  expect it to rescue a clearly under- or over-extracted brew.

### Rao: a base recipe per roast level, change only the grind

- **Finding:** Rao recommends one base recipe per roast level and, between
  coffees of similar roast, changing only the grind, aiming for a brew time
  rather than a grinder number. He gives no fixed temperature; lowering it is
  for when a well-extracted brew still tastes defective, as coarser grind,
  cooler water or lower extraction can mask some defects.
- **Evidence:** expert opinion.
- **Source:** Scott Rao, "How to approach brewing different coffees", blog,
  26 Feb 2024,
  https://www.scottrao.com/blog/2024/2/26/how-to-approach-brewing-different-coffees
- **Lever:** grind first; temperature for defects; all filter methods.
- **For the app:** prompt rule. When the bean's roast level matches earlier
  beans the person brewed well, start from that recipe and suggest grind
  changes, not a new temperature. A cooler suggestion fits "tastes off or
  defective despite good extraction".

### A roaster's case for 90–93 °C even with light roasts

- **Finding:** Wonderstate's director of coffee brews most coffees at 90–93 °C
  and rarely above about 94 °C even for very light roasts, arguing that
  near-boiling water loses delicate aromatics and pushes bitterness in
  well-developed light roasts; he says very hot water used to cover
  underdeveloped roasting.
- **Evidence:** expert opinion; his own side-by-side tests and an unnamed
  study; no blind or quantitative data.
- **Source:** Nick Breheny, "Why I Brew with Lower Water Temperatures (and Why You
  Should Try It)", Wonderstate Coffee blog, 15 May 2025,
  https://wonderstate.com/blogs/wonderstate/why-i-brew-with-lower-water-temperatures-and-you-should-too
- **Lever:** temperature; light, well-developed roasts; pour-over.
- **For the app:** prompt rule (as a counterweight). Don't assume every light
  roast wants boiling water; if a light roast's notes say bitter or muddled,
  a cooler try is legitimate.

### Origin and process don't change grind; cold beans grind finer

- **Finding:** Across single-origin coffees with different processing, the
  particle size distribution after grinding didn't depend on origin or
  process. Grinding colder beans gave a narrower distribution and a smaller
  average particle size.
- **Evidence:** peer-reviewed (Hendon's group with Perger and the
  Colonna-Dashwoods); laser diffraction on several coffees at several bean
  temperatures.
- **Source:** Uman, Colonna-Dashwood, Colonna-Dashwood, Perger, Klatt,
  Leighton, Miller, Butler, Melot, Speirs, Hendon, "The effect of bean origin
  and temperature on grinding roasted coffee", *Scientific Reports* 6:24483,
  2016, https://doi.org/10.1038/srep24483
- **Lever:** grind (bean temperature); all methods.
- **For the app:** prompt rule. When beans are frozen, expect them to grind
  finer at the same setting; a faster or slower extraction after switching to
  frozen beans is a grind effect, not a cue to change water temperature.
  Process alone isn't a reason to change grind.

## Disagreements and open questions

- **Do dark roasts extract more or less?** Lindsey 2024 found lower EY for
  darker roasts at 100 °C; Rao 2020 found TDS rising with roast; Liang 2021
  found no difference at equilibrium across light to extra-dark (with a
  darker-than-usual "light"). Different brew methods, coffees and roast
  scales likely explain it. The common claim that dark roasts are "more
  soluble" is more about speed (porosity) than total extractable material.
- **Does temperature matter at all?** Batali 2020 says hardly, at matched
  TDS/EY, but only for one medium roast at 87–93 °C in a batch brewer, tasted
  after 30 minutes. Hedrick, Hoffmann and Andueza report real flavour
  differences, especially roasty bitterness at the hot end for darker
  coffees. Nobody has run the Batali design on light and dark roasts or above
  93 °C; that is the key missing study.
- **Light roasts: boiling or 90–93 °C?** Hoffmann, Gagné and Hedrick (2023)
  favour near-boiling kettles; Breheny argues for cooler; Hedrick's 2026
  single-coffee test liked 90–93 °C best. Part of the gap is kettle vs slurry
  temperature and brewer heat loss, which most sources don't report.
- **Smrke's view on temperature** is known here only secondhand, from
  Hedrick's account of private messages about an unpublished ZHAW/Simonelli
  study. No peer-reviewed Smrke paper on brew temperature by roast was found.
- **Hedrick, "Dialing in Expensive Coffees: A Very Good Guide, Maybe the
  Best"** (YouTube, 25 Dec 2025, https://www.youtube.com/watch?v=Wv-UfbGXV3Q;
  ultra-light recipe chapter at 13:01) is said by an AI digest to start very
  light roasts around 90–91 °C, go cooler for boozy, intense (often anaerobic)
  coffees and up to about 93 °C for ultra-lights. **Unverified**: the digest
  page was empty when checked and its numbers are inconsistent. Worth
  checking against the video before using.
- **Altitude, density, variety, process → temperature:** no direct evidence
  found. Retail advice ("dense high-grown beans need hotter water") is a
  plausible extension of the light-roast reasoning but untested. Lindsey 2024
  records density and altitude but didn't test them; its natural coffee
  extracted over a wider range than the washed one, but with only two lots.
- **Barista Hustle / Matt Perger** guidance on brew temperature is behind a
  paywall and couldn't be read; secondhand sources attribute the "brew as hot
  as you can" view to Perger. Unverified.
- **Christopher Hendon:** no brew-temperature work found; his relevant paper
  here is on bean temperature and grinding (Uman 2016).

## Sources

- Andueza et al. 2003, *J. Sci. Food Agric.* 83:240–248,
  https://doi.org/10.1002/jsfa.1304
- Batali, Ristenpart, Guinard 2020, *Sci. Rep.* 10:16450,
  https://doi.org/10.1038/s41598-020-73341-4
- Breheny 2025, Wonderstate blog,
  https://wonderstate.com/blogs/wonderstate/why-i-brew-with-lower-water-temperatures-and-you-should-too
- Cotter, *SCA News* 25(15),
  https://sca.coffee/sca-news/25/issue-15/how-hot-is-hot-enough-brew-temperature-sensory-profile-and-consumer-acceptance-of-brewed-coffee-5dj5b
- Frost, Ristenpart, Guinard 2020, *J. Food Sci.* 85:2530–2543,
  https://doi.org/10.1111/1750-3841.15326
- Gagné 2018, Coffee ad Astra,
  https://coffeeadastra.com/2018/11/30/brewing-better-coffee/
- Hedrick 2023, YouTube, https://www.youtube.com/watch?v=pZ-hKmz4PIY
- Hedrick 2025, YouTube, https://www.youtube.com/watch?v=Wv-UfbGXV3Q
  (unverified claims only)
- Hedrick 2026, YouTube, https://www.youtube.com/watch?v=SsZHPcQcGIw
- Hoffmann 2020, YouTube, https://www.youtube.com/watch?v=K_r5kpXPRYo
- Liang, Chan, Ristenpart 2021, *Sci. Rep.* 11:6904,
  https://doi.org/10.1038/s41598-021-85787-1
- Lindsey et al. 2024, *Sci. Rep.* 14:29126,
  https://doi.org/10.1038/s41598-024-80385-3
- Rao, Fuller, Grim 2020, *Foods* 9:902, https://doi.org/10.3390/foods9070902
- Rao 2024, blog,
  https://www.scottrao.com/blog/2024/2/26/how-to-approach-brewing-different-coffees
- Schmieder et al. 2023, *Foods* 12:2871,
  https://doi.org/10.3390/foods12152871
- Smrke et al. 2018, *J. Agric. Food Chem.* 66:5293–5300,
  https://doi.org/10.1021/acs.jafc.7b03310
- Uman et al. 2016, *Sci. Rep.* 6:24483, https://doi.org/10.1038/srep24483
- Yeager et al. 2022, *J. Food Sci.* 87:1837–1850,
  https://doi.org/10.1111/1750-3841.16089
