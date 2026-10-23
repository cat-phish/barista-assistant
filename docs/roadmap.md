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

## Freeze corrections and local brew dates (built)

From a review of freezing (branch `freeze-edits`, migration 0032). The
freeze, thaw and refreeze cycle and the age calculation were already right.
These were missing:

- **The latest freeze period can be corrected:** change its dates, un-thaw
  it ("Still frozen"), or delete it, with the same date rules as freeze and
  thaw (`api/beans.md` §4). Brew logs don't store an age; every analysis
  works it out from the current history, so a correction applies to past
  brews automatically. AI suggestions already written stay as they are
  until re-analyzed.
- **`frozen` on every bean,** worked out from the periods by the API, not
  stored. The list, the ❄ column and the Frozen filter read it, not the
  order of the periods.
- **Local brew dates:** the worker counted age to the brew's UTC date, while
  roast and freeze dates are local, so evening brews (west of UTC) could be
  a day off. Brews now record the device's `utcOffsetMinutes`. Older brews
  use the `BREW_TIMEZONE` zone from `.env` (else UTC). It's recorded per
  brew, not set server-wide, so it stays right across daylight saving,
  travel, and bar members in other zones.
- Not done, by choice: telling the AI whether a brew was made from frozen
  beans.

## Categories rethink, part 1: the menu builder (built)

One category list did three jobs: grouping brewers (which their method
already does), the brew page's first question, and the public menu's
sections. The menu was built automatically from categories and "show on
menu" flags, so items couldn't be ordered, priced or placed on their own.
Branch `menu-builder`, migration 0033 (`api/menu.md` §7b, §7).

- **Its own sections and items:** a section has a name, an optional
  description and an order. Its items are drinks, brewers (plain brews) and
  one beans block, in order. Each item can have a menu-only name and
  description, a price (in one menu currency) and "unavailable" (still
  listed). Arranging is one `PUT /layout` with the whole menu. The UI uses
  ↑/↓ like Categories, and moves an item to another section from its Edit
  dialog.
- **The migration seeded the builder from the old automatic menu:** a
  section per category with something shown, then "Other", then "Coffee"
  with the beans, using brewers' menu names as item names.
- **Bar setup → Menu** is the new screen, with the public menu on/off switch
  (owners) and the currency. Brewer and drink forms lost their "show on the
  menu" controls. A bean's switch stays, as its place in the beans block.
- **Next (part 2):** brewers grouped by method (Filter, Espresso and a new
  Stovetop) instead of categories, drink categories for drinks only, and
  dropping the old menu columns.

## Categories rethink, part 2: brewers have methods, drinks have categories (built)

Branch `brewer-methods`, migration 0034. Brewers could still pick a drink
category: that's how a V60 appeared under "Filter" when brewing, and a brewer
could even be put in "Specialty Drinks". The method already said that, and the
brew page then repeated it again with "Just filter coffee".

- **Brewers have a method only:** Filter, Espresso, and the new **Stovetop**
  (moka pot, ibrik; styles `moka`, `ibrik`, `other`) and **Other** (style
  `other`). Stovetop and Other use filter's recipe rules and timer. They lost
  `categoryId` and the old menu fields (`menuName`, `description`,
  `showOnPublicMenu`; the menu builder holds those since part 1). Drinks lost
  `showOnPublicMenu`. Brewer and drink create/update are strict, so old
  clients sending these get a 400.
- **Categories are for drinks only.** The migration deleted categories that
  no drink used (yours: Filter and Espresso) and renumbered the rest.
- **The brew page:** "What are you making?" lists the methods that have active
  brewers, then the drink categories in order, then "Other drinks", then
  "Something else". A method goes to Brewer, then Recipe (no "Just filter").
  A category goes to Drink, then Brewer, then Recipe, as before.
- **The Brewers list** shows a Recipes count where Category was.
- **The AI** is told how to read stovetop and other brews.
- **Backlog:** item 2 now includes editable brewer methods (custom ones based
  on filter or espresso behaviour). New item 7 asks where drink categories
  should live.

## More brew parameters, part 1: TDS and extraction yield (built)

Backlog item 10, branch `brew-tds`, migration 0036. A refractometer reading
is the clearest measure of how a brew extracted, and the AI was guessing it
from taste.

- **TDS:** brew logs have an optional `tdsPercent` (> 0, ≤ 30, 2 decimals),
  entered next to the yield in the brew form and when editing a brew.
  Contract: `api/brew-logs.md` §6.
- **Extraction yield** is worked out, not stored: `TDS × beverage ÷ dose`.
  The beverage is the measured yield, or the water for immersion, cold brew
  and ibrik, since the liquid the grounds keep is as strong as the cup (the
  backlog first said to estimate it from retention). Brew logs now return the
  recipe's `style` so clients can tell which applies. The form shows it live,
  or says what's missing; the journal shows "1.38% · 20.2% extraction".
- **Brix:** a Brix (°Bx) box next to TDS fills it in as you type, using
  Beanconqueror's curve `(0.0036 × Bx + 0.7897) × Bx − 0.0071`. Only TDS is
  saved; typing a TDS by hand clears the Brix box.
- **The AI** gets `tdsPercent` and `extractionYieldPercent` for every brew,
  with typical filter and espresso ranges, and is told taste comes first.
- **Backlog:** "Choose what a repeat keeps" moved to Settings (now item 8).
  More brew parameters no longer waits for field visibility; field visibility
  (5) now comes after it.

## More brew parameters, part 2: water profiles (built)

Backlog item 10, branch `water-profiles`, migration 0037. The water changes
extraction as much as the grind, and nothing recorded it. Contract:
`api/water-profiles.md` §3c.

- **Bar setup → Water:** a per-workspace list, like grinders. Each profile
  has a name, notes and optional figures in mg/L: TDS, GH and KH (as CaCO3),
  calcium, magnesium, sodium, potassium, bicarbonate, chloride, sulfate, and
  pH. Used profiles are retired, not deleted.
- **A default:** a "Default for new brews" dropdown above the Water list
  picks one profile (or None); setting it clears the old one, and retiring it
  clears it. New brews start on it. The profile form doesn't edit it.
- **The list** sorts by name, TDS, GH, KH or date added, like Brewers and
  Grinders; the choice is remembered.
- **Brews** record `waterProfileId` (returned with `waterProfile`). The brew
  form has a Water profile dropdown, "None (no water profiles set up)" when
  the list is empty; the journal shows it.
- **The AI** gets each brew's water and its figures, with a line on how
  hardness and alkalinity change extraction.
- **Backlog:** new item 16, choose what the AI sees (Settings → AI); items
  after it moved up one. Prep tools (part 3) start unticked, and item 8's
  repeat settings decide whether a repeat keeps them.

## More brew parameters, part 3: prep tools (built)

Backlog item 10, branch `prep-tools`, migration 0038. WDT, puck screens, RDT
and the filter used change the cup, and brews didn't record them. Contract:
`api/prep-tools.md` §3d.

- **Bar setup → Tools:** an ordered list (↑/↓, like drink categories) of
  tools, each for one method or all methods. Edit the name and method in
  place, add at the bottom; used tools are retired, not deleted.
- **Seeded:** every workspace (new ones on create, existing ones by the
  migration) starts with WDT, Puck screen, Distributor, Shaker, Bottom and
  Top paper filter (espresso), Rinsed paper, Metal and Cloth filter
  (filter), RDT and Sifted fines (all methods).
- **The brew form** has a Prep checklist, unticked to start, of the recipe's
  method's tools and the all-method ones (every tool without a recipe). A
  brew keeps showing its own tools even after they're retired or moved.
- **Brew logs** take `toolIds` (PATCH replaces them) and return `tools` in
  checklist order; the journal shows "Prep: WDT · Puck screen".
- **The AI** gets each brew's `prepTools` names, and is told an empty list
  means nothing was recorded, not that nothing was used.
- **Show retired:** Brewers, Grinders and Water now show retired items with a
  "Show retired (n)" checkbox above the list controls (only when there are
  some), as Tools does, instead of a "Retired" choice in the filter. Retired
  rows are marked "(retired)" and keep the current filter and sort.

## "Retire" becomes "archive" (built)

Branch `archive-rename`, migration 0039. Beans were archived while brewers,
grinders, water profiles and prep tools were retired: two words for the same
thing. Everything now says **archive**: the screens (Archive, Show archived),
the API (`archivedAt`, PATCH `"archived": true | false`, like beans §4) and the
database (`archived_at`; the migration renames the column, keeping values).
Clients still sending `retired` get a 400.

## Archive recipes, drinks and ingredients (built)

Branch `archive-more`, migration 0040. Old recipes, seasonal drinks and
ingredients you stopped making cluttered the brew page and drink forms, and
deleting them lost history.

- Recipes, drinks and ingredients have `archivedAt` and take PATCH
  `"archived"`, like beans and equipment (archive-only PATCHes skip the recipe
  rules). Their lists get Archive / Restore and the "Show archived" checkbox.
- **Archived recipes and drinks** leave the brew page (a drink's archived
  default recipe no longer picks the brewer or recipe). **Archived recipes
  and ingredients** leave the drink form's pickers, unless that drink already
  uses them. Past brews, drinks and the public menu keep them.

## Delete from the edit page, with a warning (built)

Branch `delete-in-edit`, no migration. Deleting used to be refused for
anything with history ("archive it instead"), and lived in each list row.

- **Delete never refuses now**, for brewers, grinders, water profiles, prep
  tools, recipes, drinks and ingredients. What used the item is unlinked:
  brews lose the brewer, grinder, water, tool, recipe or drink; recipes lose
  a grinder's starting point; drinks lose a default recipe or an ingredient;
  variants move up; menu items that show it go. A brewer's recipes are
  deleted with it.
- **`GET …/:id/usage`** on each returns the counts a delete would affect
  (docs/api/README.md, "Archiving and deleting").
- **The edit page** has a Delete card at the bottom (tools: in the edit
  row). Its dialog lists what would change ("Its 2 recipes will be deleted
  too", "5 brews will lose their grinder…"), suggests archiving, and needs
  "I understand" ticked before Delete works. Nothing used: just a confirm.
  The list rows no longer have Delete, and archived rows now have Edit too.

## Refine the menu builder (built)

Backlog item 20, branch `menu-builder-refine`, no migration. The builder
worked but didn't read naturally: adding started on "A drink" one at a time,
arranging took many taps, and there was no way to see the guests' view.

- **Add picker:** drinks grouped by drink category (with **Select all**, a
  one-off "whole category"), plain brews by method and the beans block, side
  by side. What's already in the section is ticked and fixed; things in other
  sections say where. Archived drinks and brewers aren't offered. "Add N"
  sends one request: `POST /sections/:id/items` takes `{ items: [...] }`, all
  or nothing.
- **Drag and drop:** a ⠿ handle on every section and item (works on touch),
  items between sections too; one `PUT /layout` per drop. A drop that would
  put the same drink twice in a section is put back. ↑/↓ stay.
- **Wording:** each item says what it shows ("shows as “House latte” (its own
  name: Latte), its own description"), the price shows next to it, and
  Available explains that unavailable items stay on the menu, struck through.
- **Preview:** Edit / Preview / Side by side (side by side from 1100px wide),
  remembered per workspace. `GET /menu/preview` returns the public menu's
  shape for any member, even with the public menu off; `MenuPreview.vue`
  renders it and is ready for the guest page (item 19).
- Sections stay mixed (no beans-only kind). Per-size prices moved to item 19's
  open questions.

## Public menu page (built)

Backlog item 19, branch `public-menu-page`, migration 0041. The public menu
API existed, arranged in the builder, but nothing showed it to guests.

- **The guest page** is `/menu/:slug`: no login, no app header, the bar's
  name and its sections as the builder arranges them, readable on a phone in
  light and dark. The router skips the session check for it (`meta.public`).
  "This menu isn't available" when it's off or unknown.
- **Offline:** the service worker serves the page shell for `/menu/*` and
  the last menu it fetched (NetworkFirst, already configured); the page says
  "Offline: showing the last saved menu".
- **Bean details are chosen in the builder:** the beans block's Edit dialog
  has "Show for each bean" (flavour notes, origin, producer, altitude,
  process, roast level, roast date as "roasted 5 days ago", and decaf / blend
  / roasted-for badges). Stored as `menu_items.bean_fields` (null = all).
  The public response now sends only those, and never stock levels.
- **Sharing:** with the public menu on, the Menu tab shows the page's link
  (Copy, Open) and a QR code to download and print.
- `MenuPreview.vue` renders both the builder's preview and the guest page.
- **Look and title:** the menu title is largest and brown, section headings
  are larger than the items, brown, with a brown rule under them. The title
  is set in the Menu tab ("Menu title"; migration 0042, `menu_title`, blank =
  the workspace name) and returned as `title` by the menu and public menu.
- **Backlog:** item 19 is now "Public menu: branding and sizes" (accent
  colour, tagline, logo; per-size prices).
