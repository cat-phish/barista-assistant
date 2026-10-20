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
- **Brewers:** whatever makes the coffee (V60, Chemex, AeroPress, an
  espresso machine), with a kind: pour over, immersion or espresso. The kind
  decides the recipe fields (it can't change while recipes use the brewer).
  Espresso brewers also record what they can do: pre-infusion (none /
  automatic / manual), flow control and pressure control (none / manual /
  programmable). A brewer has an optional category (where it's listed when
  brewing) and can go on the menu as the plain brew, under a menu name
  ("Espresso" for the machine). Retired like grinders once brews used it;
  deleting is refused while recipes or drinks use it.

## Recipes
- Dose, water (live coffee:water ratio), temperature, target finish window.
- **Expected yield** fills in automatically from a light-roast estimate
  (grounds keep ≈ 2 g of water per g of coffee). Typing your own number
  keeps it; "Use estimate" switches back.
- **Steps** run one after another, each with a time and how it moves on:
  **automatically**, **automatically with a "Log it" button** (to record when
  you really did it), or **when you tap Next** (the time is a guide; e.g. a
  bloom that waits for the kettle to reach temperature). Pour-over types:
  bloom, pour, swirl, stir, wait, press, other, with a "pour to" weight and
  an optional temperature ("pour at 93 °C"). Each row shows when it's planned
  to start; drag to reorder, or insert between steps. The last step can run
  until you finish.
- **Grind starting points** per grinder, and an optional **default grinder**
  that's selected for you when you brew the recipe (otherwise the last
  grinder you used).
- **Espresso recipes:** dose and target shot weight (ratio 1:2 style), target
  shot time and first-drop windows, temperature, and a **shot profile**: steps
  of pre-infusion, soak (pump off), pressure (bar) or flow (g/s or ml/s, set
  per recipe), each held or ramped ("9 → 6 bar", "4 → 2 g/s"), which can also
  end **at first drop**. E.g. 9 bar until first drop → soak 10 s → flow 4 → 2
  g/s until done; or pre-infuse 3 bar 10 s → soak 10 s → 9 bar.

## Drinks & ingredients
One **Recipes** section with three tabs: Recipes, Drinks, Ingredients.
- **Ingredients:** reusable preps that finish a drink: milk, foam, syrup,
  ice, water, other, each with free-text instructions (e.g. orange-infused
  cold foam: steep peel in cream overnight). An ingredient a drink uses can't
  be deleted.
- **Drinks:** what you serve. A drink is built on one **brewer** and
  can be made with any recipe of that brewer (an optional default is
  preselected), finished with ingredients in order, each with an amount (a
  number and a unit: fl oz, ml, g, or any typed unit like "pump", which is
  then suggested next time) and a note ("Orange cold foam · 40 g · spooned on
  top"). An optional **default size** (fl oz or ml) is what the amounts are
  for. A plain "V60" isn't a
  drink: it's the brewer itself, which can go on the menu (Equipment →
  Brewers: show on menu, menu name, description, category).
- **Variants:** like cocktail riffs, a drink can be a variant of another
  (Vanilla Latte of Latte, Iced Vanilla Latte of Vanilla Latte). **Make a
  variant** copies the drink into a new, independent one linked to it; later
  changes to either don't carry over. The list shows variants under their
  parent; deleting a drink moves its variants up a level.
- **Categories:** a managed, ordered list ("Espresso milk drinks", "Specialty
  drinks") on the Drinks page: add, rename, reorder, delete (its drinks and
  brewers become uncategorised). They're the first choice when brewing, and
  group drinks in the list and on the menu.

## Brewing
- **Category → Brewer or drink → Recipe:** pick a **category** (Pour Over,
  Espresso, Espresso Milk Drinks…, then Other for uncategorised ones), then
  one of its **brewers** (V60, Chemex) or **drinks** (variants under their
  parent; "On Delonghi" shows the drink's brewer), then one of that brewer's
  recipes, with the drink's default selected. The last choices are
  remembered. A drink with a default size gets a
  **Size** field: 12 fl oz on an 8 fl oz latte scales every ingredient ×1.5
  (rounded to whole ml/g, 0.1 fl oz, or half pumps/spoons). On a filter
  brewer the coffee batch scales too; an espresso shot stays as the recipe
  says. The size made is saved on the log and shown in the journal, and the
  AI sees the scaled amounts. **Something else (no recipe)** logs a brew
  without one. A drink's ingredients show as **Finish with**, on setup and on
  the log, and the brew is saved with the drink.
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
  instead; typing any one updates the others. The brew records its recipe's
  brewer, so the espresso machine comes with the recipe.
- **Timer** (pour over and espresso): Previous / Current / Up next cards; the
  current one shows the instruction ("Pour to 150 g (+100)", "9 → 6 bar",
  "Pump off"), the temperature and how it ends, with **Next** or **Log it**
  buttons for steps that need them. Each step starts when the previous one
  really ended. Espresso adds a big **First drop** button (judged against the
  recipe's window), and notes when your machine can't set the pressure or
  flow a step asks for. With no steps it's just the clock (+ First drop).
  The real times (taps, logs, first drop) are saved with the brew, shown in
  the journal and sent to the AI. The log asks for the shot weight, shot
  time and an optional **first drop** you can type in if you didn't tap.
- **Yield estimate:** water − retention × dose. Retention comes from your
  measured brews of this bean with this recipe (median), else the recipe's
  expected yield adjusted for the bean's roast, else a roast-level default.
  Fluid ounces assume brewed coffee weighs about 1 g per ml.
- **Finish & Save** is available throughout; the screen stays awake.
- **Log:** dose, water, measured yield, temperature, grind, time, rating and
  tasting notes; can also be logged without the timer.

## Journal & AI
- **Journal:** every brew, newest first, filterable by bean; entries can be
  edited or deleted.
- **AI analysis:** after a brew, ask for a suggestion; a background worker
  asks the LLM for grind and temperature changes with reasoning, shown next
  time you brew that bean. It sees the bean's roast level and age, the
  recipe, your previous brews of that bean, the grinder's details and, for
  espresso, the machine's capabilities and the shot timer's taps, and the
  drink it was for (so milk in the tasting notes isn't blamed on the coffee).

## Public menu
- An optional public page per workspace listing beans, plus plain
  **brewers** (under their menu name) and **drinks** marked as shown, in
  sections by category order (name, description, brewer, the parent it's a
  variant of, ingredients; no recipe details).

## App
- Installable PWA, works on phones, offline-cached public menu.

## Ideas noted for later
- **User settings:** the roast level recipes assume (light today) and units
  (g / fl oz shown together today).
- **Ingredients:** batch prep and stock tracking (e.g. how much cold foam is
  left), and structured ingredients instead of free text.
- **Public menu page:** a frontend for the menu (only the API exists).
