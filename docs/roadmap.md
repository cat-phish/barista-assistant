# Recipe Expansion Roadmap

Design agreed on 2026-10-19. Each phase is its own feature branch off `dev`.
The detailed contracts live in `schema.md`, `api/` (index in `api/README.md`) and
`timer_architecture.md` once a phase is built; this file keeps the overall
plan and the decisions behind it. Planned work that isn't built yet lives in
[`backlog.md`](backlog.md).

## Model

| Concept | What it is | Examples |
|---|---|---|
| **Brewer** | What makes the coffee, with a `kind` (the method); espresso brewers have capabilities. | V60, AeroPress, Linea Mini |
| **Recipe** | One way to brew with a brewer. | "V60 Standard", "1:2 espresso, 8 s pre-infusion" |
| **Ingredient** | A reusable prep with its own instructions. | orange-infused cold foam, steamed oat milk, vanilla syrup |
| **Drink** | What is served and shown on the public menu: a brewer (any of its recipes) plus ingredients. Can be a variant of another drink. | "Oat Latte", "Vanilla Latte" (variant of Latte), "The Atlas" (V60 + orange cold foam) |
| **Drink category** | An ordered section for drinks and brewers: the first choice when brewing, and the menu's sections. | "Pour Over", "Espresso milk drinks" |

## Phase 1: Scaling + bean roast level (built)

- Beans get an optional `roastLevel`.
- At brew setup a recipe can be scaled by dose, water or beverage yield (g or
  US fl oz); the others follow. The coffee:water ratio is editable too. Pour
  targets scale with water; step times stay the same. (Details:
  `features.md`.)
- Yield is estimated as `water − retention × dose`. Retention (water the
  grounds keep, g per g of coffee) comes from, in order: the median of your
  measured brews of this bean with this recipe; else the recipe's own
  expected yield adjusted for the bean's roast; else the roast-level default.
- The per-roast defaults are an assumption (published figures say about
  2–2.5 g/g overall, with no measured light/dark split). Measured brews
  replace them as soon as they exist.
- Recipe forms estimate yield for a **light roast**.
  **TODO (user settings):** make the recipe form's assumed roast level a
  user setting.

## Phase 2: Method kinds, espresso, machines, marks

Built in steps on `feature-espresso`: **2a** method kinds + espresso recipes
and logs (built); **2b** machines + equipment screens (built); **2c** shot
timer + marks + AI (built); **2d** step engine (built): steps run back to
back for every recipe, each moving on automatically, with a "Log it" button,
on a tap, or (espresso) at first drop, with optional temperature, pressure
and flow (ramps as instructions). This brought phase 4 (profiles) forward:
the shot profile *is* the step list. Pour-over gaps were migrated to Wait
steps.

- Methods get a `kind`: `pour_over`, `immersion`, `espresso`. The kind picks
  the recipe fields, step types and timer behaviour.
- Espresso: ratio is dose : yield out (no water in); first-drop window and
  shot-time window on the recipe; pre-infusion as a step.
- Machines are workspace equipment like grinders, chosen at brew time and
  saved on the log. Capabilities: pre-infusion (none / automatic / manual),
  flow or pressure control (none / manual / programmable). Building this out
  includes proper add/edit screens for machines and grinders where users
  tick what their equipment can do.
- Timer adapts to the machine: automatic pre-infusion runs on the clock;
  manual shows a cue and a tap records when it really ended; none greys the
  step out so the recipe still works.
- Decisions (2026-10-19): existing methods map V60 → pour over, Espresso →
  espresso, AeroPress → immersion, Latte → espresso (until phase 3), others →
  pour over. A method's kind can't change while recipes use it. Immersion has
  the pour-over fields for now. Espresso recipes need a target yield and have
  no water; brew-log water becomes optional (not used for espresso).
- Grinders get optional details: stepped / stepless, setting range and step
  size (so the AI can say "2 clicks finer"), burr type and size, manual /
  electric. Machines: pre-infusion, flow control and pressure control kept
  separate. Only espresso brews show the machine picker; used machines are
  retired, not deleted.
- 2b also added an Equipment section (Grinders / Machines / Methods tabs),
  including a methods screen to rename, change kind and delete. Grinder
  details and machine capabilities already reach the AI analysis.
- Brew logs get **marks**: tapped events with the second they happened, from
  a fixed list (`first_drop`, `preinfusion_end`, later `flow_change`…). First
  drop is a tap for everyone. Stored in their own table. The AI analysis
  receives the method kind, marks and machine capabilities; its response
  format is unchanged for now.
- **Later:** dose / yield suggestions for espresso from the AI (backlog
  item 6).

## Phase 3: Drinks + ingredients (built)

Built on `feature-drinks`: ingredients and drinks (Recipes / Drinks /
Ingredients tabs), the drink picker when brewing, drinks on brew logs and in
the AI context, the public menu listing drinks, Latte retired.

- A drink has a default recipe; the recipe can be changed at brew time.
- Ingredients are reusable preps (type: milk, foam, syrup, ice, water, other)
  with free-text instructions to start. A drink lists ingredients with an
  amount and a note ("40 g, spooned on top").
- Brew logs record the recipe brewed and, optionally, the drink.
- The public menu shows drinks instead of recipes. The migration creates a
  plain drink for each public recipe. The "Latte" default method is retired
  (removed where unused).

**Restructured (migrations 0015/0016):** drinks felt disparate (a drink could
mix recipes of any method, categories were free text), so:

- A drink is built on one method; any recipe of that method can make it,
  with an optional default. The per-drink recipe list is gone.
- Variants work like Bar Assistant's parent cocktails: an independent copy
  linked to its parent, at any depth, with no live inheritance.
- Categories are a managed, ordered list (`drink_categories`).
- Plain drinks ("V60") became the method's own menu entry (show on menu,
  description, category).
- Brew setup is Method → Drink → Recipe.

**Sizes (migrations 0017/0018):** drinks have an optional default size and
ingredient amounts are a number + unit (free-text amounts were parsed, the
rest moved to the note), so brewing can scale a drink; brew logs record the
size made.

**Ingredients and brewers (migrations 0019–0021):** "components" are now
"ingredients" everywhere. Brew methods and espresso machines merged into
**brewers** (a V60 and a Linea Mini are both brewers; the kind is the method).
Recipes and drinks belong to a brewer, and brew logs record the recipe's
brewer. Where a workspace had one machine and one espresso method, the
machine took over the method's recipes, drinks and menu entry (shown as
"Espresso"). Brew setup is now Category → Brewer or drink → Recipe.
Trade-off: a second espresso machine needs its own recipes.

**Drink instructions and tasting (migration 0023):** drinks have free-text
instructions, shown after the brew. Brews of a drink with ingredients record
the shot (rating and notes, if tasted straight) and the finished drink
separately; the AI context labels every brew with how it was served.

**Drinks by type (migrations 0024/0025):** a drink needed one brewer, so The
Atlas couldn't be made on a Chemex, and drink categories had no brewer choice
while brewer categories did. Now a drink needs a **type** (the method kind) and
any brewer of it can make it; brewing is always Category → Drink (or a plain
brew) → Brewer → Recipe. Recipes still belong to one brewer.

**Filter vs espresso (migration 0026):** pour over and immersion behaved the
same, and as drink requirements they were too narrow (The Atlas works on a
V60, a French press, an AeroPress or an OXO Rapid Brewer). The brew method is
now **Filter** or **Espresso**; how a filter brewer brews is a descriptive
**style**. Brewers without recipes now show on the brew page with a prompt to
add one, instead of silently hiding (which made categories look empty).

**Style on recipes (migrations 0027/0028):** style moved from brewers to
recipes, and espresso got styles too (standard, soup, other): one brewer brews
several ways (an AeroPress inverted or bypass, a soup shot on the same
machine). Recipes took their brewer's style; espresso recipes became standard.

## Phase 4: Flow and pressure profiles (done in 2d)

- Pressure (bar) and flow (g/s or ml/s per recipe) on espresso steps, held or
  ramped, shown by the timer as instructions.

## Phase 5: Bean details (built)

Backlog item 6, built on `bean-details` (migrations 0029/0030). A bean was a
roaster, name, process, roast level, roast date and stock; what it's roasted
for, its origin, price and where to buy it again all affect how it's brewed
and whether to reorder. Contract: `api/beans.md` §4.

- **New optional fields:**
  - roasted for (filter / espresso / omni) and blend type
  - decaf
  - flavor profile
  - producer, region and altitude (metres)
  - a per-bag price (amount + ISO currency, both or neither) and bag weight
  - purchase date and green bean supplier
  - website (http(s) only), a 1–5 rating, and notes
- **Process** became a fixed list of keys (`BEAN_PROCESSES`: washed …
  lactic fermentation). Free text was mapped to keys; anything else was
  cleared. Making it editable is backlog item 2.
- **Roast level:** the form asks for the traditional roast name (Cinnamon …
  French, called "Roast Level") and shows the 5-step level it implies
  read-only. The API derives `roastLevel` from `detailedRoastLevel` with
  `DETAILED_ROAST_TO_LEVEL`, so the yield estimate is unchanged. Beans from
  before keep a 5-step level set on its own until a name is picked.
  Choosing which scale to use is backlog item 4.
- **Price per gram** is calculated for display, not stored. A bean bought
  again is edited, not a new purchase record (no purchase history yet).
- **Public menu** gets the roast, blend and origin details, decaf and the
  flavor profile. Price, purchase date, supplier, website, rating and notes
  stay private.
- **AI** gets roast type, roast name, blend, decaf, flavor profile, region
  and altitude, with a line in the system prompt on how to use them.
- Altitude in feet is backlog item 3. Hiding the fields a bar doesn't use is
  item 5.

## Phase 6: Bean archive and rating prompt (built)

Backlog item 8, built on `bean-archive` (migration 0031). Finished beans
stayed in one unsortable list forever, and an unrated bean says nothing about
whether to buy it again. Contract: `api/beans.md` §4.

- **Archive:** beans have `archivedAt` (null = active), set through PATCH
  `archived: true/false`, like a grinder's `retired`. Archived beans leave
  the brew picker and the public menu; past brews, the journal and the AI
  keep them. A bean with brew history offers **Archive instead** of delete.
- **Date added:** beans got `createdAt`. Beans from before 0031 have the
  migration's time.
- **List:** Active | Archived tabs and a table like Recipes, with a filter
  (in stock, out of stock, frozen, decaf). It sorts by name, roaster, date
  added, purchase date, frozen state, roast (lightness on the 12-step scale),
  process, rating, roast date, roast age (frozen days excluded), stock, or
  caffeinated/decaf. Sort and filter are remembered per tab. On wide screens
  the table shows ten columns, each a sortable header: coffee, a ❄ for
  frozen, roaster, roast, process, age, caf/decaf, stock, added and rating.
  Phones show coffee, roaster, roast, stock and rating.
- **Duplicate** (like recipes): a new bag of the same coffee. The copy keeps
  the coffee's details (roaster, name, origin, roast, price, website,
  notes) and clears the roast and purchase dates and the rating; stock
  starts at the bag weight. A copy of an older bean with only a 5-step roast
  level keeps it.
- **Sort controls (every list):** Beans, Recipes, Drinks, Ingredients,
  Brewers and Grinders have **Sort by** and **Order** dropdowns, replacing
  the single combined Sort dropdown. Order is worded for the column, e.g.
  "Descending (newest first)".
- **Rating prompt:** item 8 first planned to ask after a few brews or when
  stock runs low. Instead the prompt comes when a bean is archived: an
  unrated bean asks for a rating first (or **Skip rating**), and the Archived
  tab lists unrated beans with **Rate** until they're rated.
