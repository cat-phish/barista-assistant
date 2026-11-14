# Grind, fines and burrs

Particle size distribution, fines and boulders, grinder speed and feed rate,
burr geometry, bean temperature at grinding, and how grind trades off
against temperature and contact time. Written for the "Suggest parameters"
prompt and for Insights; see the [README](README.md) for the rules.

## Summary

1. **The fines share, not the average size, drives flow.** Two ZHAW
   studies (capsules and espresso) found that the share of particles under
   about 100 µm sets bed permeability and so contact time, at a similar
   median size. Moving the grind dial mostly moves the amount of fines.
   (Peer-reviewed.)
2. **Finer is not always more extraction.** In espresso, extraction yield
   peaks and then falls at the finest settings because flow goes uneven; a
   slightly coarser grind (with a smaller dose) gave equal yield and more
   repeatable shots. In pour-over, Gagné found the best cup was not the
   finest, highest-yield one. (Peer-reviewed for espresso; hobbyist data for
   filter.)
3. **Grinder settings don't transfer between grinders.** Low-fines
   ("unimodal") burrs need a much finer setting to reach the same flow, and
   gave higher extraction in one controlled hobbyist test. A "step" means a
   different change in fines on every grinder. The app should reason in
   steps of *this* grinder and learn from the user's own history.
4. **Burr labels are weak predictors.** Across 24 espresso grinders, flat
   burrs averaged fewer fines than conicals but the ranges overlapped a lot,
   and burr diameter showed no clear trend. Treat burr type as context, not
   a rule. (Controlled hobbyist data, ZHAW-measured.)
5. **RPM effects are grinder-specific and small next to the grind
   setting.** No consistent RPM effect on distribution across 24 grinders;
   practitioners report higher RPM often runs finer/faster at the same dial
   number. Feed rate (slow feeding, augers) has a larger, measured effect:
   coarser grounds with fewer fines, needing a much finer setting.
6. **Cold beans grind finer and narrower.** Freezer-cold beans gave a
   smaller and narrower distribution than room-temperature beans, with most
   of the change already at about −19 °C. Expect to grind a little coarser
   (or accept a slower brew) when grinding straight from the freezer.
   (Peer-reviewed.)
7. **Dark roasts grind finer at the same setting and charge more.** Drier,
   darker beans produced much finer particles and more static at a given
   setting; a little water on the beans before grinding cut clumping and
   lengthened espresso shots. (Peer-reviewed.)
8. **"Clarity vs body" is a real trade-off, but taste links are thin.**
   Experts associate more fines with body and fewer with clarity, and warn
   that both too many and too few fines can raise astringency. There is no
   controlled blind tasting linking a measured distribution to preference.
9. **Lever order:** at fixed strength and extraction, drip-brew temperature
   barely changed the sensory profile, and in immersion grind size barely
   changed the final yield (it changes speed). Grind is the primary lever in
   percolation because it sets both surface area and contact time;
   temperature is a secondary trim. See also
   [temperature-roast-solubility.md](temperature-roast-solubility.md).

## Findings

### Fines share sets flow and contact time

- **Finding:** At similar median particle size, ground coffee with a larger
  share of fines (under 100 µm) gave longer extraction times in capsules;
  in espresso, adding sieved fines lowered bed permeability, slowed flow and
  lengthened the shot. A coarser grind with fines added behaved much like a
  finer grind. Both papers conclude that the median size alone does not
  describe a grind.
- **Evidence:** peer-reviewed. Capsules: several commercial coffees, ground
  and measured by dynamic image analysis. Espresso: one coffee, one grinder
  (Bentwood Vertical 63), 1–4 g of sieved fines added to a 20 g dose at
  three settings, three replicates, Camsizer X2 measurement.
- **Source:** Eiermann A., Smrke S., Guélat L.-M., Wellinger M., Rahn A.,
  Yeretzian C., "Extraction of single serve coffee capsules: linking
  properties of ground coffee to extraction dynamics and cup quality",
  *Scientific Reports* 10:17079, 2020, https://doi.org/10.1038/s41598-020-74138-1.
  Smrke S., Eiermann A., Yeretzian C., "The role of fines in espresso
  extraction dynamics", *Scientific Reports* 14:5612, 2024 (CC BY 4.0),
  https://doi.org/10.1038/s41598-024-55831-x.
- **Lever:** grind; espresso and any percolation brew.
- **For the app:** prompt rule. Tell the AI that a grind change mainly
  changes the fines amount and therefore flow/contact time; for a shot or
  drawdown that is too fast or too slow, the grind step is the first fix.

### Fines change flow more than they change flavour chemistry

- **Finding:** In the same espresso study, extraction yield followed one
  curve against shot time whether or not fines were added: fines changed
  permeability, not the extraction mechanism, and the effect on extraction
  efficiency was marginal. Shots with extra fines were not penalized in an
  informal tasting; the best-rated shots sat around 30 s and 19–20 % yield.
  Very short shots still reached most of the maximum yield.
- **Evidence:** peer-reviewed, one coffee; tasting was small and not
  blind.
- **Source:** Smrke, Eiermann, Yeretzian 2024 (above),
  https://doi.org/10.1038/s41598-024-55831-x.
- **Lever:** grind, time; espresso.
- **For the app:** prompt rule. Don't blame fines for bitterness in
  espresso by default; reason from shot time and yield first. Insight:
  plot rating against shot time per coffee, since time (set by grind) is
  what the grind actually moves.

### Espresso extraction falls at the finest grinds

- **Finding:** Measured espresso extraction yield rose as the grind got
  finer, peaked, then fell at the finest settings, while a homogeneous-flow
  model predicted it would keep rising. The authors read the drop as uneven
  flow (parts of the bed starved of water), which also made shots less
  repeatable. Grinding a little coarser with a smaller dose (their example:
  20 g down to 15 g, EK43 from 1.7 to 2.3) reached the same yield with less
  shot-to-shot variation.
- **Evidence:** peer-reviewed; model plus lab espresso series on an EK43.
  Full text not read here (paywalled); details from the abstract listing
  and press coverage.
- **Source:** Cameron M. I., Morisco D., Hofstetter D., Uman E., Wilkinson
  J., Kennedy Z. C., Fontenot S. A., Lee W. T., Hendon C. H., Foster J. M.,
  "Systematically Improving Espresso: Insights from Mathematical Modeling
  and Experiment", *Matter* 2(3):631–648, 2020,
  https://doi.org/10.1016/j.matt.2019.12.019; summary at
  https://www.sciencedaily.com/releases/2020/01/200122110447.htm.
- **Lever:** grind, ratio (dose); espresso.
- **For the app:** prompt rule. If an espresso is already very fine and
  the user reports sour-and-bitter together, inconsistency, or low yield
  despite long times, suggest going *coarser* (optionally with a smaller
  dose), not finer. Insight: per-grinder grind setting vs rating curve,
  which should show a peak rather than "finer is better".

### Uneven flow explains why finer can extract less

- **Finding:** A two-pathway model of the espresso bed shows that below a
  critical grind size a small early difference in porosity between paths
  grows as one path extracts and opens up, so extraction drops as the grind
  gets finer, matching the Cameron et al. measurements.
- **Evidence:** peer-reviewed; mathematical model fitted to published
  data, no new tasting.
- **Source:** Lee W. T., Smith A., Arshad A., "Uneven extraction in coffee
  brewing", *Physics of Fluids* 35(5):054110, 2023,
  https://doi.org/10.1063/5.0138998 (preprint: https://arxiv.org/abs/2206.12373).
- **Lever:** grind; espresso, likely any percolation bed.
- **For the app:** none directly; supports the "coarser can be better"
  rule above.

### Low-fines burrs need a finer setting and extracted higher

- **Finding:** In alternating espresso shots on the same machine and
  profile, a Weber EG-1 with SSP ultra-low-fines burrs had to be set much
  finer than a Niche Zero to build similar resistance, and its shots
  extracted about 1.3 percentage points higher (filtered TDS) at a 1:4
  ratio. Pressure fell faster through the shot and crema was much thinner.
  Measured retention was about 0.2 g on both grinders. Taste was not tested.
- **Evidence:** controlled hobbyist test; 11 shots, one coffee, one
  session; refractometer readings blinded, shots not.
- **Source:** Jonathan Gagné, "A Comparison between Standard and Low-Fines
  Espresso Shots", *Coffee ad Astra*, 2021-05-10,
  https://coffeeadastra.com/2021/05/10/a-comparison-between-standard-and-low-fines-espresso-shots/.
- **Lever:** grind (burr type); espresso.
- **For the app:** prompt rule. Never compare grind numbers across
  grinders; with a low-fines/unimodal burr expect finer settings and
  faster-declining pressure. Retention of ~0.2 g is noise for brew ratio,
  so only flag retention when the logged value is well above that.

### Across 24 espresso grinders, burr labels predict little

- **Finding:** In about 300 distributions from 24 espresso grinders (one
  coffee, ZHAW Camsizer data from Kaffeemacher), conical burrs on average
  made more fines and more boulders than flat burrs, but with large
  overlap; burr diameter showed no clear trend; RPM showed no consistent
  effect beyond sometimes shifting the size. Grinders that were more
  "unimodal" (fewer fines) were also more uniform, contrary to common
  belief. Dialing in espresso mostly means adjusting fines per gram, and
  low-fines grinders had to be set finer. The best-tasting grinders in
  Kaffeemacher's ratings sat mid-range, so the taste link is unproven.
- **Evidence:** controlled hobbyist analysis of lab-measured data; one
  unit per model, alignment unknown, RPM and feed rate not controlled.
- **Source:** Jonathan Gagné, "What I learned from analyzing 300 particle
  size distributions for 24 espresso grinders", *Coffee ad Astra*,
  2023-09-21,
  https://coffeeadastra.com/2023/09/21/what-i-learned-from-analyzing-300-particle-size-distributions-for-24-espresso-grinders/.
- **Lever:** grind (burr type, size, RPM); espresso.
- **For the app:** prompt rule. Pass burr type and size to the AI as
  context only, with an instruction not to make strong taste promises from
  them. Insight: for users with more than one grinder, compare rating
  distributions per grinder on the same bean.

### Sieved uniform grinds extracted less than normal bimodal grinds

- **Finding:** In filter and French press, grinds sieved into narrow,
  uniform size classes gave lower TDS and fewer bioactive compounds than the
  normal bimodal grind straight from the grinder; the very fine uniform
  fraction extracted the least despite its surface area. Normal grinds gave
  brews richer in volatile and bioactive compounds. The authors conclude
  that distribution matters as much as size.
- **Evidence:** peer-reviewed; chemical analysis, not a sensory preference
  test. Full text not read; findings from the repository abstract.
- **Source:** Angeloni G., Masella P., Spadi A., Guerrini L., Corti F.,
  Bellumori M., Calamai L., Innocenti M., Parenti A., "Using ground coffee
  particle size and distribution to remodel beverage properties", *European
  Food Research and Technology* 249:1247–1256, 2023,
  https://doi.org/10.1007/s00217-023-04210-3 (record:
  https://flore.unifi.it/handle/2158/1302121).
- **Lever:** grind (distribution); filter, immersion.
- **For the app:** prompt rule. Don't tell users that sifting or a more
  uniform grind will raise extraction; it can lower it. Frame uniformity as
  a clarity choice, not a strength/yield fix.

### Fines can migrate and clog the filter

- **Finding:** Granular-physics experiments show that shaking a bed sets up
  wall-driven circulation that sorts particles by size without needing
  large jolts; in a cone the sorting can reverse. Gagné argues that any
  motion bringing fines to the paper can partly block its pores, slowing
  and unevening the drawdown. He notes this rests on dry glass-bead
  experiments, not coffee.
- **Evidence:** expert opinion grounded in a physics paper (Knight, Jaeger
  & Nagel 1993); no coffee measurement. A Barista Hustle tapping test and
  Gagné's own glow-in-the-dark tracer experiments did not show migration in
  espresso (reported via search snippets; both paywalled or not read).
- **Source:** Jonathan Gagné, "The Physics of Fines Migration", *Coffee ad
  Astra*, 2020-02-01,
  https://coffeeadastra.com/2020/02/01/the-physics-of-fines-migration/.
- **Lever:** grind, agitation; paper-filter pour-over.
- **For the app:** prompt rule. When a pour-over stalls late or drains
  unevenly, suggest coarser grind or gentler late agitation before
  suggesting lower temperature. See
  [agitation-pour-structure.md](agitation-pour-structure.md).

### In pour-over, the finest grind isn't the best cup

- **Finding:** In a seven-brew V60 grind series, extraction rose steadily
  as the grind got finer, but the best-tasting brew was a step short of the
  finest. Gagné's hypothesis is that fine grind combined with long contact
  time over-extracts particle surfaces and that clogging makes flow uneven;
  he suggests a stronger brew ratio with bypass water as a way to grind
  finer without the long drawdown. He calls the results preliminary.
- **Evidence:** controlled hobbyist test; one person, informal blind
  tasting, seven brews.
- **Source:** Jonathan Gagné, "Why Can't we Grind Coffee Finer for Pour
  Over?", *Coffee ad Astra*, 2020-04-02,
  https://coffeeadastra.com/2020/04/02/why-cant-we-grind-coffee-finer-for-pour-over/.
- **Lever:** grind, time, ratio; pour-over.
- **For the app:** prompt rule. When a pour-over is already slow and the
  user asks for more sweetness/extraction, don't keep moving finer; suggest
  holding grind and raising temperature, or a stronger ratio with bypass.
  New suggestion output: an optional "bypass water" amount.

### Water reaches only the outer layer of large particles

- **Finding:** Gagné estimates that water extracts only the outer shell of
  each particle (about 100 µm in his 2019 post, about 40 µm in his 2020
  post), so particles larger than a few hundred microns keep an under-used
  core. Boulders therefore lower the extraction ceiling, and pushing harder
  to reach their core over-extracts everything else.
- **Evidence:** expert opinion with a simple geometric model; the depth
  estimate comes from a Barista Hustle video and a model fit, not a direct
  measurement, and the two posts disagree on the number.
- **Source:** Jonathan Gagné, "Extracting Shells of Coffee", *Coffee ad
  Astra*, 2019-01-17,
  https://coffeeadastra.com/2019/01/17/extracting-shells-of-coffee/; and
  the 2020 pour-over post above.
- **Lever:** grind (boulders); all methods, most for coarse filter grinds.
- **For the app:** prompt rule. For weak, hollow, sour cups at a coarse
  setting, grind finer before raising time a lot; on grinders known to make
  many boulders (often conicals, cheap flats), expect a lower extraction
  ceiling.

### A "happy medium" of fines, and body vs clarity

- **Finding:** Rao proposes that both too many fines (clogging and
  bypass channels) and too few (wide open paths) raise astringency, so the
  best fines level is whatever minimizes astringency for a given brewer;
  espresso wants more fines than filter. He calls the flat-for-clarity,
  conical-for-body rule too simple. Hedrick's espresso course, in the
  same spirit, recommends high-fines grinders (Niche, Robur) for dark-roast
  body and crema and high-clarity unimodal burrs for light roasts, and
  states a "coarse as you can" rule for dark roasts.
- **Evidence:** expert opinion; Rao labels it speculation drawn from
  experience and Gagné's work; Hedrick's course is undated demonstration.
- **Source:** Scott Rao, "The happy medium amount of fines", 2023-09-06,
  https://www.scottrao.com/blog/happymediumfines. Lance Hedrick ×
  Meticulous, "Dark Roast 101: Chasing Body & Crema" (lesson 7), 04:27
  "Grinder Choice & Particle Distribution" and 16:07 "Coarse-as-You-Can
  Rule", undated,
  https://meticuloushome.com/pages/meticulous-x-lance-hedrick-espresso-onboarding.
- **Lever:** grind (burr type); roast level; espresso and filter.
- **For the app:** prompt rule. Use burr type plus roast level as context:
  with a unimodal burr and a dark roast, a "thin" complaint points to a
  finer grind or more dose; with a high-fines grinder and a light roast, an
  "astringent/muddy" complaint points to coarser plus gentler agitation.
  Mark this as opinion in the prompt.

### Variable RPM mostly shifts the peak, conjecturally

- **Finding:** Hedrick argues that changing RPM on his grinders mainly
  shifts the main particle peak rather than the fines amount, and reports
  that faster RPM gave faster extraction on some burrs (he corrected in the
  description that Base burrs extracted higher when redialed). He states
  that none of it is proven. Gagné's 24-grinder analysis likewise found RPM
  effects specific to each grinder and often limited to a size shift.
- **Evidence:** expert opinion (Hedrick, explicitly conjectural);
  controlled hobbyist data (Gagné). A Barista Hustle article reportedly
  found slower grinding gave fewer fines and higher extraction but worse
  taste, which they could not explain (paywalled; **unverified**, seen only
  in a search snippet).
- **Source:** Lance Hedrick Unfiltered, "Not What You Think: Variable RPM
  and Grinder Behavior", YouTube, 2024-02-15,
  https://www.youtube.com/watch?v=2T8Ymg94GXo, 2:45 "RPM and Fines", 5:18
  "What is Variable RPM doing? (Peak Particle Size Distribution)", 14:15
  "Observation of Faster RPM Faster Extraction" (chapter titles; podcast
  version: https://lancehedrickunfiltered.podbean.com/e/009-not-what-you-think-grinder-theory-and-variable-rpm,
  2024-02-26). Gagné 2023 (above).
- **Lever:** grind (RPM); variable-speed grinders, mainly espresso.
- **For the app:** prompt rule. Treat an RPM change as a grind change of
  unknown size: change RPM *or* setting in one suggestion, never both, and
  only suggest RPM as an experiment to test, not a fix. Insight: for
  variable-speed grinders, rating vs RPM on the same bean, shown only with
  enough brews per RPM.

### Slow feeding makes grounds coarser with fewer fines

- **Finding:** On a DF64, feeding beans slowly (by hand or with a feeder)
  made the grind coarser and cut the fines share by roughly 5–10
  percentage points at the same setting; shots ran far faster (one coffee
  went from about 25 s to about 10 s). Matching shot time needed roughly
  half the dial number, which brought the fines share back above the
  normal-feed level. Tasting was mixed: clearer and sweeter for some
  coffees, no gain or clogging for another. Hedrick reported the same
  speed-up and says auger grinders show it much less.
- **Evidence:** controlled hobbyist test with ZHAW Camsizer measurement,
  two coffees and n=5 shots in the second test; tasting small and not
  blind.
- **Source:** Benjamin Hohlmann, "Slow feeding", Kaffeemacher, 2025-05-03,
  https://kaffeemacher.de/en/blogs/kaffeewissen/slow-feeding. Lance
  Hedrick, "INSTANT IMPROVEMENT ON ANY GRINDER: How Slow Feeding Completely
  Changes Your Grinding", YouTube, 2024-02-22,
  https://www.youtube.com/watch?v=7_U8nwO4cy0 (timestamp not verified);
  "Grinder Hack Proven? Slow Feeding Vindicated", Lance Hedrick Unfiltered,
  2025-05-05, https://www.youtube.com/watch?v=tMoMOAVSK7o (timestamp not
  verified).
- **Lever:** grind (feed rate); espresso on non-auger grinders.
- **For the app:** prompt rule. If a user's shots suddenly run much faster
  at an unchanged setting, ask about feed technique or a new grinder
  before suggesting temperature. Possible future field: "slow fed" on a
  brew.

### Colder beans grind finer and narrower

- **Finding:** Cooling beans before grinding (EK43, Turkish burrs) gave a
  smaller and narrower particle distribution; most of the narrowing happened
  between room temperature and a −19 °C freezer, with further cooling adding
  less. Distribution did not depend on origin or processing. Beans cooled
  and then warmed back up ground like beans never cooled. Taste was not
  studied. Kaffeemacher reports a narrower main peak with more fines from
  frozen beans, advises grinding espresso straight from frozen, and notes
  some coffees need a slightly coarser setting.
- **Evidence:** peer-reviewed (four light-medium Arabicas, one grinder,
  laser diffraction); Kaffeemacher is practitioner guidance without stated
  measurement method.
- **Source:** Uman E., Colonna-Dashwood M., Colonna-Dashwood L., Perger M.,
  Klatt C., Leighton S., Miller B., Butler K. T., Melot B. C., Speirs R. W.,
  Hendon C. H., "The effect of bean origin and temperature on grinding
  roasted coffee", *Scientific Reports* 6:24483, 2016 (CC BY 4.0),
  https://doi.org/10.1038/srep24483. Benjamin Hohlmann, "Freeze coffee",
  Kaffeemacher, 2025-02-15,
  https://kaffeemacher.de/en/blogs/kaffeewissen/freeze-coffee.
- **Lever:** grind (bean temperature); all methods.
- **For the app:** prompt rule. When a brew has frozen days set and the
  previous one didn't (or vice versa), expect a finer effective grind from
  frozen beans and adjust the grind suggestion by about one usual step
  rather than changing temperature. Insight: rating and time for frozen vs
  not-frozen brews of the same bean.

### Dark roasts grind finer; moisture cuts static and clumps

- **Finding:** Charge on ground coffee rose with drier beans and finer
  grinds; darker (drier) roasts charged more and produced much finer
  particles than light roasts at the same setting. Adding a little water to
  the beans before grinding reduced static and clumping, gave longer
  espresso extraction times and stronger, more consistent shots. Origin and
  processing were unrelated to charge. Only espresso was tested; taste was
  not.
- **Evidence:** peer-reviewed; lab charge measurements and espresso
  trials. Full text not read; details from press coverage of the paper.
- **Source:** Méndez Harper J., Hendon C. H. et al., "Moisture-controlled
  triboelectrification during coffee grinding", *Matter* 7(1):266–283,
  2024 (online 2023-12-06), https://doi.org/10.1016/j.matt.2023.11.005;
  coverage: https://phys.org/news/2023-12-coffee-splash-static-electricity-intense.html.
  Discussed in James Hoffmann, "Science Discovers What We All Missed: More
  Than An Anti-Static Hack", YouTube, 2023-12-08,
  https://www.youtube.com/watch?v=nLnB99VJ0HE.
- **Lever:** grind; roast level; espresso.
- **For the app:** prompt rule. When switching a recipe from a light to a
  dark roast, start coarser; the same dial number grinds finer on darker
  beans. Note that a bean spray (RDT) slows shots, so a user who starts
  spraying may need to go coarser.

### New burrs drift coarser; single dosing is fine

- **Finding:** Over about 24 lb of seasoning coffee on new SSP burrs, the
  grind at a fixed setting drifted coarser and then grew more uniform, with
  the size settling after about 10–12 lb. Separately, "popcorning" (the last
  beans bouncing in the hopper) made bean-by-bean grinding coarser, but a
  normal single dose ground almost the same as from a full hopper (much less
  than one click).
- **Evidence:** controlled hobbyist tests; one grinder each, image-based
  particle analysis.
- **Source:** Jonathan Gagné, "Seasoning Grinder Burrs and Grind Quality",
  *Coffee ad Astra*, 2019-05-27,
  https://coffeeadastra.com/2019/05/27/seasoning-grinder-burrs-and-grind-quality-2/;
  "Grind Quality and the Popcorning Effect", 2019-04-12,
  https://coffeeadastra.com/2019/04/12/grind-quality-and-the-popcorning-effect/.
  See also Lance Hedrick, "You Need To Season Your Grinder: Fact or Cap?",
  YouTube, 2024-03-31, https://www.youtube.com/watch?v=PSgdqd7eWMw
  (content not verified here).
- **Lever:** grind; new burrs.
- **For the app:** Insight. On a grinder added recently, show grind
  setting over time for repeated beans; a slow drift finer to hit the same
  time suggests seasoning, so the AI should weight recent brews more.

### Grind before temperature: the lever order

- **Finding:** UC Davis drip brews at 87, 90 and 93 °C, with grind and time
  adjusted to hit the same strength and extraction, tasted essentially the
  same: the sensory profile followed TDS and extraction, not temperature.
  In full immersion, grind size changed final extraction only slightly
  (about 19–23 % across roughly 580–1310 µm) while temperature mainly
  changed how fast equilibrium arrived. In espresso, flow rate had the
  largest effect on what reached the cup, stronger at finer grinds and
  hotter water, but all three were small next to total beverage mass.
- **Evidence:** peer-reviewed (trained descriptive panels and lab
  extraction series).
- **Source:** Batali M. E., Ristenpart W. D., Guinard J.-X., "Brew
  temperature, at fixed brew strength and extraction, has little impact on
  the sensory profile of drip brew coffee", *Scientific Reports* 10:16450,
  2020, https://doi.org/10.1038/s41598-020-73341-4. Liang J., Chan K. C.,
  Ristenpart W. D., "An equilibrium desorption model for the strength and
  extraction yield of full immersion brewed coffee", *Scientific Reports*
  11:6904, 2021 (CC BY 4.0), https://doi.org/10.1038/s41598-021-85787-1.
  Schmieder B. K. L., Pannusch V. B., Vannieuwenhuyse L., Briesen H.,
  Minceva M., "Influence of Flow Rate, Particle Size, and Temperature on
  Espresso Extraction Kinetics", *Foods* 12(15):2871, 2023 (CC BY 4.0),
  https://doi.org/10.3390/foods12152871.
- **Lever:** grind, temperature, time, ratio; drip, immersion, espresso.
- **For the app:** prompt rule. Order of moves: (1) ratio/yield if
  strength is wrong; (2) grind if extraction or contact time is wrong in a
  percolation brew; (3) temperature as a trim once time is on target, or
  when grind is pinned by clogging/drawdown limits; (4) in immersion, steep
  time before grind. One lever per suggestion.

## Disagreements and open questions

- **Does a more uniform grind extract more?** Gagné's low-fines espresso
  test found higher extraction with SSP burrs, while Angeloni et al. found
  sieved uniform grinds extracted *less* than normal bimodal ones in filter
  and French press. Sieving removes material and changes the bed, so the
  two aren't the same experiment; unresolved.
- **Do fines cause bitterness/astringency?** Smrke et al. saw no sensory
  penalty from added fines in espresso; Rao and Hedrick tie excess fines
  (or fines pushed through by high flow) to astringency and bitterness,
  Rao also blames *too few* fines. No blind sensory study links a measured
  distribution to these attributes.
- **RPM:** practitioner reports conflict on whether lower RPM means fewer
  fines (Barista Hustle, reportedly yes but tasted worse; Hedrick, no, it
  shifts the peak; Gagné, inconsistent across grinders). Lower RPM often
  needs a different setting, which confounds most comparisons. No
  peer-reviewed RPM study found.
- **Fines migration:** a plausible mechanism (Gagné) but tests in espresso
  (tapping, tracer) did not show it; untested in pour-over with coffee.
- **Water penetration depth:** Gagné gives about 100 µm (2019) and about
  40 µm (2020) in different posts.
- **Unimodal "over-shooting":** Gagné found more unimodal grinders needed
  slightly *more* fines per gram at dial-in and has no explanation.
- **Dial-in step size:** no source measured how big a grind step should be
  per change. The evidence only says a step is grinder-specific (fines vs
  gap curves differ in slope) and that one click can matter more than
  popcorning or burr brand differences. The app should use the grinder's
  recorded "usual adjustment" and learn from history rather than assert a
  universal step.
- **Freezing:** Uman et al. found narrower distributions; Kaffeemacher
  reports *more* fines. Both could hold (finer overall), but it means the
  "frozen = cleaner" claim is not settled.

## Sources

- Angeloni et al. 2023, *Eur Food Res Technol* 249:1247–1256,
  https://doi.org/10.1007/s00217-023-04210-3
- Batali, Ristenpart, Guinard 2020, *Sci Rep* 10:16450,
  https://doi.org/10.1038/s41598-020-73341-4
- Cameron et al. 2020, *Matter* 2(3):631–648,
  https://doi.org/10.1016/j.matt.2019.12.019
- Eiermann et al. 2020, *Sci Rep* 10:17079,
  https://doi.org/10.1038/s41598-020-74138-1
- Gagné, Coffee ad Astra: "Extracting Shells of Coffee" (2019-01-17),
  "Grind Quality and the Popcorning Effect" (2019-04-12), "Seasoning
  Grinder Burrs and Grind Quality" (2019-05-27), "The Physics of Fines
  Migration" (2020-02-01), "Why Can't we Grind Coffee Finer for Pour
  Over?" (2020-04-02), "A Comparison between Standard and Low-Fines
  Espresso Shots" (2021-05-10), "What I learned from analyzing 300 particle
  size distributions for 24 espresso grinders" (2023-09-21);
  https://coffeeadastra.com/category/particle-size-distribution/
- Hedrick, Lance: "Not What You Think: Variable RPM and Grinder Behavior"
  (2024-02-15), https://www.youtube.com/watch?v=2T8Ymg94GXo; "INSTANT
  IMPROVEMENT ON ANY GRINDER: How Slow Feeding Completely Changes Your
  Grinding" (2024-02-22), https://www.youtube.com/watch?v=7_U8nwO4cy0;
  "Grinder Hack Proven? Slow Feeding Vindicated" (2025-05-05),
  https://www.youtube.com/watch?v=tMoMOAVSK7o; "You Need To Season Your
  Grinder: Fact or Cap?" (2024-03-31),
  https://www.youtube.com/watch?v=PSgdqd7eWMw; Meticulous × Lance Hedrick
  course, https://meticuloushome.com/pages/meticulous-x-lance-hedrick-espresso-onboarding
- Hoffmann, James: "Science Discovers What We All Missed: More Than An
  Anti-Static Hack" (2023-12-08), https://www.youtube.com/watch?v=nLnB99VJ0HE
- Hohlmann, Kaffeemacher: "Freeze coffee" (2025-02-15),
  https://kaffeemacher.de/en/blogs/kaffeewissen/freeze-coffee; "Slow
  feeding" (2025-05-03),
  https://kaffeemacher.de/en/blogs/kaffeewissen/slow-feeding
- Lee, Smith, Arshad 2023, *Phys Fluids* 35(5):054110,
  https://doi.org/10.1063/5.0138998
- Liang, Chan, Ristenpart 2021, *Sci Rep* 11:6904,
  https://doi.org/10.1038/s41598-021-85787-1
- Méndez Harper, Hendon et al. 2024, *Matter* 7(1):266–283,
  https://doi.org/10.1016/j.matt.2023.11.005
- Rao, Scott, "The happy medium amount of fines" (2023-09-06),
  https://www.scottrao.com/blog/happymediumfines
- Schmieder et al. 2023, *Foods* 12(15):2871,
  https://doi.org/10.3390/foods12152871
- Smrke, Eiermann, Yeretzian 2024, *Sci Rep* 14:5612,
  https://doi.org/10.1038/s41598-024-55831-x
- Uman et al. 2016, *Sci Rep* 6:24483, https://doi.org/10.1038/srep24483
