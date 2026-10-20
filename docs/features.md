# Features

What the app does, briefly, kept up to date as features land. The contracts
are in `schema.md`, `api_spec.md` and `timer_architecture.md`; the plan for
upcoming work is in `roadmap.md`.

## Accounts & workspaces
- **Accounts:** email + password; the session is an httpOnly cookie.
- **Workspaces:** shared spaces (e.g. a household or café) with roles: owner,
  barista (can log and edit), viewer (read-only).

## Beans
- Roaster, coffee name, process, **roast level** (light → dark, optional),
  roast date and stock.
- **Freezing:** freeze/thaw periods pause the bean's roast age, so "days off
  roast" stays meaningful for frozen coffee.

## Equipment
One **Equipment** section with three tabs:
- **Grinders:** per workspace, with optional details: stepped/stepless,
  setting range and step size, burr type and size, hand/electric. The range
  and step let the AI talk in clicks. Grinders that have been used are
  retired rather than deleted, so history keeps their names.
- **Machines:** espresso machines with what they can do: pre-infusion (none
  / automatic / manual), flow control and pressure control (none / manual /
  programmable). Picked on espresso brews only (the last one used, or the
  only one, is preselected); retired like grinders.
- **Methods:** brew methods (V60, Espresso, …) with a kind: pour over,
  immersion or espresso. The kind decides the recipe fields. Rename, change
  kind (not while recipes use it), delete (not while recipes use it), add.

## Recipes
- Dose, water (live coffee:water ratio), temperature, target finish window.
- **Expected yield** fills in automatically from a light-roast estimate
  (grounds keep ≈ 2 g of water per g of coffee). Typing your own number
  keeps it; "Use estimate" switches back.
- **Timed steps:** bloom, pour, swirl, stir, wait, press, other; each with a
  start/end time and, for pours, a cumulative "pour to" weight. Steps can be
  dragged to reorder (re-timed to fit) and inserted between others.
- **Grind starting points** per grinder.
- **Espresso recipes:** dose and target shot weight (ratio 1:2 style), target
  shot time and first-drop windows, temperature and an optional pre-infusion
  time. No water.

## Brewing
- **Setup:** pick bean, recipe and grinder. The grind pre-fills from your
  last brew of that recipe on that grinder, else the AI suggestion, else the
  recipe's starting point.
- **Batch scaling:** type any one of dose, water, yield (g) or yield (US
  fl oz) and the rest follow. The **ratio** (the 15 in 1:15) starts at the
  recipe's and can be changed; whatever you typed last is held. Pour targets
  scale with the water; step times stay the same. A much bigger or smaller
  dose than the recipe suggests a coarser or finer grind. "Reset to recipe"
  undoes it all.
- **Espresso shots:** the same setup shows dose, ratio and shot weight
  instead; typing any one updates the others, plus the machine.
- **Shot timer:** a big **First drop** button (judged against the recipe's
  window: early / in the window / late), and pre-infusion that follows the
  machine: it runs by itself on automatic machines; on manual ones (or with
  no machine chosen) it counts down to **Full pressure now** and a tap
  records when you opened up; machines without pre-infusion skip it. The
  taps are saved with the shot, shown in the journal and sent to the AI. The
  log asks for the shot weight (compared with the target) and shot time.
- **Yield estimate:** water − retention × dose. Retention comes from your
  measured brews of this bean with this recipe (median), else the recipe's
  expected yield adjusted for the bean's roast, else a roast-level default.
  Fluid ounces assume brewed coffee weighs about 1 g per ml.
- **Timer:** clock-driven (no tapping to advance). Shows Previous / Current /
  Up next, with a progress bar for steps and waits; steps and waits have
  different backgrounds. Finish & Save is available throughout. Keeps the
  screen awake.
- **Log:** dose, water, measured yield, temperature, grind, time, rating and
  tasting notes; can also be logged without the timer.

## Journal & AI
- **Journal:** every brew, newest first, filterable by bean; entries can be
  edited or deleted.
- **AI analysis:** after a brew, ask for a suggestion; a background worker
  asks the LLM for grind and temperature changes with reasoning, shown next
  time you brew that bean. It sees the bean's roast level and age, the
  recipe, your previous brews of that bean, the grinder's details and, for
  espresso, the machine's capabilities and the shot timer's taps.

## Public menu
- An optional public page per workspace listing beans and recipes marked as
  shown. (Moving to drinks: see `roadmap.md` phase 3.)

## App
- Installable PWA, works on phones, offline-cached public menu.

## Ideas noted for later
- **User settings:** the roast level recipes assume (light today) and units
  (g / fl oz shown together today).
