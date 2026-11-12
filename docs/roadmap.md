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

## Settings: shell and Workspace tab (built)

Backlog item 1, branch `settings-shell`. Workspace configuration was spread
out (the public menu's switch, title and currency on Bar setup → Menu) or
missing (no way to rename the web address or delete a workspace).

- **Settings** is a ⚙ link in the top header (icon only on phones), so the
  six nav tabs still fit 320px. `/settings/*` screens share
  `SettingsLayout.vue`: a grouped nav (`SettingsNav.vue`, after Bar
  Assistant's personal / bar groups) beside the tab from 750px wide; on a
  phone `/settings` is the list and each tab has "‹ Settings".
- **Settings → Workspace:** name and web address (owners; others see them
  read-only), with a warning that the old `/menu/<slug>` and printed QR
  codes stop working; the public menu's switch, link, QR code, title and
  currency (moved from the menu builder, same permissions); and deleting
  the workspace by typing its slug.
- **API:** `PATCH /api/workspaces/:id` accepts `slug` (`409` if taken). No
  redirect from the old address.
- The menu builder keeps arranging only, with a line saying whether the
  public menu is on and linking to Settings. `slugify` and `SLUG_PATTERN`
  moved to `lib/slug.ts`, shared with creating a workspace.
- **Settings storage** is decided but not built: JSON columns on
  `workspaces` and `users`, added with the first real setting (item 3).

## Settings: Members tab (built)

Backlog item 1, branch `settings-members`. The members API (§2 Members) had
no screen: adding a barista meant calling the API by hand.

- **Settings → Members** lists everyone by email, with "You" on your own
  row. Owners change roles with a select, remove members, and add someone by
  email and role. The person must have registered first (no email
  delivery); "No account with that email" says so. Everyone else sees the
  roles as read-only labels.
- A short legend says what owner, barista and viewer can do
  (`lib/roles.ts`, shared with the workspace list).
- **Demoting yourself** asks first; **removing** someone and **leaving**
  confirm too. Leaving takes you to your other workspace, or the workspace
  list. The last owner can't demote themselves or leave: the API's `409`
  shows as "Make someone else an owner first".
- No API change; tests now cover the list order, adding (including `404`
  and `409`), changing a role, removing, and a second owner leaving.
- **"I understand" confirmations** (new `CLAUDE.md` rule 6, now 7: major actions
  that can't be undone or affect other things get the checkbox, asked
  first): leaving and deleting a workspace, removing a member, demoting
  yourself, changing the web address (now a dialog instead of an inline
  warning), deleting a bean with its history, and deleting a drink
  category. Leave is a red button.

## Settings: Account tab (built)

Backlog item 1 (now finished and removed from the backlog, which was
renumbered), branch `settings-account`. The API could change a password and
delete an account (`docs/api/auth.md` §1), but no screen used either.

- **Settings → Account**, under **You**: your email; **change password**
  (current, new twice, at least 8 characters; other devices are logged out,
  this one stays); **delete account** (re-enter the password and tick "I
  understand"). While you're the only owner of a workspace, deleting is
  refused and the dialog lists those workspaces, each linking to its Members
  tab.
- The ⚙ Settings link now shows whenever you're logged in, also before you
  have a workspace; `/settings` then opens Account.
- No API change (the auth tests already covered both calls).
- **Backlog:** item 1 (Settings) is done; the old item 21 is now item 20
  with only change email, log out everywhere and password reset left. The
  settings-storage decision moved to item 2 (Units and defaults), the first
  real setting.

## Section tabs on small phones (fix)

Branch `section-tabs-mobile`. Bar setup's six tabs (Brewers … Menu) were
squeezed into one row, and on a 320–375px phone their labels ran into each
other. `SectionTabs.vue` now keeps one row from 601px wide; narrower, a bar
with more than four tabs wraps into two even rows (3 + 3), with a little
less padding. Recipes / Drinks / Ingredients and Active / Archived stay on
one row.

## Units and defaults (built)

Backlog item 2 (finished and removed from the backlog, which was
renumbered), branch `units-and-defaults`, migration 0043. Estimates assumed
a light roast, yields showed in g and fl oz, altitude in metres and
temperatures in °C, whoever was looking.

- **Settings storage** (the first real settings): JSON `users.preferences`
  and `workspaces.settings`, null or missing keys = defaults
  (`DEFAULT_PREFERENCES`, `DEFAULT_WORKSPACE_SETTINGS` in
  `@barista/shared`). They ride along on responses the app already loads
  (`user` from /me, login and register; every workspace), so there are no
  GET endpoints, only `PATCH /api/auth/me/preferences` and
  `PATCH /api/workspaces/:id/settings` (owners). Unknown keys are `400`.
- **Settings → You → Preferences** (per person, saved on change): volume
  (fl oz / ml, and "also show" the other), temperature (°C / °F), altitude
  (metres / feet).
- **Settings → <workspace> → Defaults** (owners edit): "Recipes are written
  for a … roast". It replaces the hard-coded light roast: the recipe form's
  estimate, the baseline when a bean's roast adjusts a recipe's yield, and
  beans with no roast level.
- **Storage never changes** (grams, °C to 0.1, whole metres); `lib/units.ts`
  converts at the edges. Form text keeps 0.1 °F so saving an untouched
  value gives back exactly what was stored (93.3 °C ↔ 199.9 °F); lists show
  whole °F. Feet are whole and convert back to the same metre.
- **Brew page:** the "Yield ≈ (g)" field is gone; the yield shows in your
  volume unit(s), and typing either one drives the batch (`scaleBatch`
  gained an ml lead). Espresso shot weight stays in grams.
- **°F everywhere °C was:** recipe target and step temperatures, the brew
  form and setup, journal, recipe list, timer, and AI suggestion changes
  (+1 °C shows as +2 °F). The AI prompt stays in Celsius.
- **Feet:** the bean form and bean list; the guest menu always shows metres.
- **New drinks** start with your volume unit as their size unit.

## Roast level scale (built)

Backlog item 2 (finished and removed from the backlog, which was
renumbered), branch `roast-level-scale`, no migration (a new key in
`workspaces.settings`). The bean form only offered roast names (Cinnamon,
City, Full City+ … French), and many bags just say "medium".

- **Settings → Defaults → How beans record their roast** (owners): **roast
  names** (as before) or **light to dark**. Per workspace, so everyone
  records beans the same way.
- **Light to dark** in the bean form: one "Roast level" select (light …
  dark, or not sure). A bean that already has a roast name shows its level,
  with "Recorded as City+. Choosing another level replaces it." Leaving it
  keeps the name; another level sends `detailedRoastLevel: null` with the
  new `roastLevel` in the same save. A copy keeps the name the same way.
- **Lists and the guest menu** show only the 5-step level in light-to-dark
  mode (`roastLabel(bean, scale)` in `lib/beans.ts`); the public menu and
  preview send `detailedRoastLevel: null`. Names stay stored, so switching
  back to roast names shows them again.

## Dark mode (built)

Branch `dark-mode`, no migration (a new key in `users.preferences`). The
app only had a light palette; a browser's forced dark mode was darkening it.

- **Settings → Preferences → Theme:** System (default, follows the device),
  Light or Dark. Per person, so it follows the account; also kept per
  device (`localStorage` `brewlog.theme`) and applied by a snippet in
  `index.html` before the app loads, so there's no light flash.
  `lib/theme.ts` sets `data-theme` on `<html>`; `main.ts` applies the saved
  preference.
- **One palette:** `base.css` gives every colour token a dark value, for
  `[data-theme="dark"]` and for `prefers-color-scheme: dark` unless Light is
  chosen. New tokens for what was hard-coded: `--on-brand` (text on brown
  buttons, dark in dark mode since the brand turns light tan),
  `--brand-line` / `--brand-edge` / `--brand-soft`, `--danger-solid`,
  `--on-success`, `--warning` / `--warning-tint`. The timer and recipe form
  use them instead of fixed colours.
- **The guest menu** follows the guest's own device (no preference to read).
  QR codes stay on white so they scan.
- `<meta name="color-scheme" content="light dark">`; the phone's status bar
  colour follows the theme.

## Editable bean processes (built)

Backlog item 1, part 1 of 3 (styles and methods follow), branch
`editable-processes`, migrations 0044–0046. Bean processes were a fixed
list of ten keys; new ones (yeast inoculated, double fermentation) keep
appearing.

- **Data:** a `bean_processes` table per workspace (name, position,
  hidden, `builtin` key), seeded with the ten built-ins (new workspaces too).
  `beans.process` (a key) became `beans.processId` (FK, set null on delete):
  0044 adds the table and column, 0045 seeds every workspace and maps each
  bean's key to its row, 0046 drops the old column.
- **API** (`docs/api/bean-processes.md` §4b): list, add, rename/hide,
  reorder, usage, delete (custom only; built-ins `409`). Beans take and
  return `processId` and must use their own workspace's processes. The
  public menu and the AI context get the process's name.
- **Settings → Lists** (owners and baristas edit): `EditableList.vue`, a
  reusable list editor (add, rename, ↑/↓, hide/show, delete) that styles
  and methods will reuse. Deleting goes through `DeleteDialog` ("N beans
  will lose their process", with "I understand" when anything uses it, and
  "hide it instead" as the suggestion).
- **Bean form** offers the visible processes, plus the bean's own if it's
  hidden; the bean list shows and sorts by the workspace's names
  (`beanSortColumns(processName)`).

## Editable recipe styles (built)

Backlog item 1, part 2 of 3 (methods follow), branch `editable-styles`,
migrations 0047–0049. Recipe styles were a fixed list per method; bars
want their own ("Inverted", "Bypass", "Turbo shot").

- **Data:** a `recipe_styles` table per workspace, a list per brewer method
  (kind, name, position, hidden, `builtin` key, `brewsLike`), seeded with
  the built-ins of each method (new workspaces too). `recipes.style` (a
  key) became `recipes.styleId`: 0047 adds the table and column, 0048
  seeds every workspace and maps each recipe's key to the row for its
  brewer's method, 0049 drops the old column.
- **Brews like:** a custom style picks which of its method's built-ins it
  brews like. Extraction yield (journal, brew form, worker) and the AI go by
  it, so an "Inverted" style that brews like immersion is worked out from
  the water. Built-ins always brew like themselves.
- **API** (`docs/api/recipe-styles.md` §5e): list, add (with `brewsLike`),
  rename/hide/change brews-like, reorder per method, usage, delete (custom
  only). Recipes take `styleId` (the workspace's, for the brewer's method)
  and return `style: { id, name, brewsLike }`; brew logs' recipe too. The
  AI context gets `{ name, brewsLike }` and the prompt explains custom
  names.
- **Settings → Lists → Recipe styles:** method tabs (Filter, Espresso,
  Stovetop, Other) over the same `EditableList`, which gained an optional
  per-entry choice ("Brews like": a select when adding, and on each custom
  row).
- **Recipe form** offers the method's visible styles (plus the recipe's own
  if hidden); the recipes list sorts styles by name; brewers summarise their
  recipes' style names; the brew page's recipe picker shows the style name.

## Custom brewer methods (built)

Backlog item 1, part 3 of 3 (finished: item 1 is removed from the backlog,
which was renumbered), branch `custom-methods`, migrations 0050–0051. The
brew methods were fixed (Filter, Espresso, Stovetop, Other), so a siphon or
an ibrik setup had to hide under "Other".

- **Named groups on a behaviour** (agreed when planning item 1): a
  `brewer_methods` table per workspace (name, position, hidden, `builtin`,
  `behaviour`), seeded with the four built-ins; brewers gained `methodId`
  (0050 adds both, 0051 seeds and puts every brewer under its kind's
  built-in). A brewer's `kind` stays and is always its method's behaviour,
  so recipe fields, the timer, styles, drinks, prep tools and the AI are
  unchanged. Drinks still need a kind, so a filter drink can be made on a
  Siphon brewer.
- **API** (`docs/api/brewer-methods.md` §3e): list, add (with behaviour),
  rename/hide, change a custom method's behaviour (its brewers' kind
  follows; `409` while recipes use them), reorder, usage, delete (custom
  only: its brewers move to the built-in of the same behaviour). Brewers
  take `methodId` (older clients' `kind` alone means that kind's built-in).
  Menu item sources and the public menu say how a plain brew is made by its
  method name.
- **Settings → Lists → Brewer methods** with "Works like" on each custom
  method; the list editor shows the server's reason when a change is
  refused and puts the select back.
- **Brewer form** picks a method ("Siphon works like filter: …"); the
  brewer list shows and filters by method; "What are you making?" lists the
  workspace's methods that have brewers, so Siphon is its own choice with
  its own brewers; the menu builder groups plain brews by method.

## More brew parameters, part 4: grind speed and grinder weights (built)

Backlog item 6, the last part (the item is now closed), branch
`brew-weights-rpm`, migrations 0052 and 0053. Variable-speed grinders and
grinder retention both change the cup, and brews didn't record them.
Contract: `api/grinders.md` §3b, `api/brew-logs.md` §6.

- **Grinders** get a **Variable speed** switch and an optional RPM range
  (50–5000, both or neither, only when variable speed). Switching it off
  clears the range.
- **Brews** record `grindRpm`, but only with a variable-speed grinder, and
  within its range when the RPM is sent, so an old brew stays editable
  after the range changes. Moving a brew to a grinder without speed control
  means clearing the RPM. The brew form shows **Speed (RPM)** only for those
  grinders, and pre-fills it with the last setting for that grinder and
  recipe (`last-setting` now returns `grindRpm`).
- **Beans in / grounds out:** two optional weights on a brew; out can't be
  more than in. `actualDoseGrams` stays the dose that went into the brew.
  **Grinder retention** (in − out) is worked out, not stored, like
  extraction yield. It's named "grinder retention" everywhere so it isn't
  confused with the water the spent grounds keep (`lib/scale.ts`). The form
  shows "Grinder retention 0.3 g (1.6%)" as you type; the journal shows
  "18.2 g in → 17.9 g out · 0.3 g retained (1.6%)".
- **The AI** gets the grinder's speed details, each brew's `grindRpm`, both
  weights and `grinderRetentionGrams`. It's told RPM is part of the grind, so
  it should compare settings at similar speeds.

## Brew setup and timer fixes from first use (built)

Branch `brew-setup-tweaks`, no migration. Small things noticed after using
the grinder weights and speed (part 4 above).

- **Batch linking:** typing the dose keeps the water and changes the
  ratio, and typing the water keeps the dose (before, each moved the other
  at a fixed ratio). The ratio still moves the water, a yield sets both, and
  the yield estimate follows every change. Espresso: the dose and the ratio
  move the shot weight, and the shot weight changes the ratio. The worked-out
  ratio is held exactly and shown to 0.1 (`linkRatio`, `lib/scale.ts`).
- **Grinder weights and speed on setup:** they're measured before the timer,
  so setup asks for beans in, grounds out and (variable-speed grinders) the
  RPM. The log form keeps them, already filled in. **Grounds out fill the
  dose:** on setup as a typed dose (so the ratio changes), and in the log and
  journal forms directly.
- **Timer layout:** the step cards come first, then the buttons, then the
  clock, and the step text is larger (instruction 1.8rem, countdown 2rem,
  side cards and the small line about 1.05rem).

## Numeric grind settings (built)

Branch `numeric-grind`, migration 0054. Grind settings were free text, so
phones showed a full keyboard and "18 clicks" or "20" could both be stored.
Now they're the number on the grinder's dial, like its setting range.

- `brew_logs.actual_grind_setting` and `recipe_grind_settings.setting` are
  `decimal(6,2)` (0 ≤ x < 10000, at most 2 decimals; shared
  `grindSettingSchema`). The migration converted the existing values, which
  were all numbers already. Text gets a `400`. `last-setting`, the
  suggestion's base grind and the AI context are numbers too.
- Every grind box (brew setup, the log and journal forms, the recipe's
  starting points) opens a number pad (`inputmode="decimal"`) and says when
  it isn't a number; settings show without trailing zeros ("20", "4.25").
- A setting of 0 counts as a setting (the pre-fill used to skip blanks).
- Multi-ring grinders ("2.1.0") are a backlog idea ("Grind settings for
  multi-ring grinders").

## Bean batch numbers (built)

Branch `bean-batch`, migration 0055. Home roasters roast a little of the same
coffee at a time and log each batch as its own bean, which then looked
identical everywhere.

- Beans get an optional **Batch no.** (`batchNumber`, free text ≤ 50: "3",
  "R-12"), next to the roast date in the bean form.
- It shows after the name everywhere a bean is picked or titled ("Onyx –
  Guji · Batch 3": the brew and journal pickers, the bean list, journal
  headings); brew logs' `bean` carries it. `beanLabel` / `batchSuffix` in
  `lib/beans.ts`.
- **Copy bean** suggests the next batch for a whole number ("3" → "4"), and
  leaves other formats blank.
- The AI gets it, told that the brews it sees are all of that one batch.
  Not on the public menu.

## Field visibility (built)

Backlog item 1, branch `field-visibility`, no migration (it's a workspace
setting). The brew, bean and recipe forms had grown long, and not every bar
uses a refractometer, tracks price or sets step temperatures. Contract:
`api/workspaces.md` §2, "Field visibility".

- **Settings → Fields:** a "show" checkbox for each optional field, grouped as
  Brews, Beans and Recipes. Owners change them for the whole workspace
  (`settings.hiddenFields`, a list of keys like `brew.tds`); others see them
  read-only.
- **One registry,** `frontend/src/lib/fields.ts`, lists the optional fields
  (key, form, label). Required fields aren't in it, nor a brew's rating and
  tasting notes, which the AI works from. The API checks keys by shape
  (`brew|bean|recipe.name`), so the list lives only in the frontend.
- **Forms** wrap each optional field in `show(key)` (`useFieldVisibility`):
  brew setup, the log and journal forms (`BrewFields`), the bean form and the
  recipe form. Paired fields go together (Brix + TDS, price + currency,
  growing area + country). Espresso's First drop button on the timer stays,
  since first-drop steps need it; only the log box hides.
- **Nothing recorded disappears:** values are kept and sent back as they
  were, history views are unchanged, and a hidden field that has a value
  when a form opens stays shown (`reveal`, judged on opening, so the box
  doesn't vanish when you clear it). A filter recipe's expected yield, when
  hidden, is still estimated.
- **The AI is unchanged:** it gets whatever is recorded; choosing what it
  sees stays a separate backlog item.
- **Rule** (spec and `CLAUDE.md`): every new optional brew, bean or recipe
  field gets a registry entry and a `show()` in its form.

## Drink categories move to the Drinks page (built)

Backlog item "Where drink categories live", branch `drink-categories-home`,
frontend only. Categories only group drinks now (brewers are grouped by
method, the public menu has its own sections), but they were edited under Bar
setup next to brewers and grinders.

- The categories editor (`DrinkCategoriesPanel`: add, rename, ↑/↓, delete)
  is at the bottom of the **Drinks** page, below the list, with a link to it
  in the page's intro. Changing one reloads the list, so renamed categories
  show at once. Shown while there are no drinks yet too.
- Bar setup loses its Categories tab; `/setup/categories` redirects to
  `/drinks#categories`, which scrolls to the editor.
- What categories do is unchanged: the drink groups under "What are you
  making?", after the methods, in their order. A drink stays in one
  category.

## Repeat a brew (built)

Backlog item "Repeat a brew", branch `repeat-brew`, frontend only (brew logs
already return everything). Dialing in is "same as last time, one click
finer", but every brew started from the recipe.

- **Where:** **Brew again** on every journal entry (the list and the entry
  page) opens `/brew?repeat=<id>`. Brew setup shows a "Repeat a brew" row
  with quick buttons for the latest brew of each of the last 3 things made
  (a drink, or a plain brew of a method, so a Latte and a straight shot
  differ; from the last 30 brews). **Pick a brew…** opens a dialog of
  earlier brews, briefer than the journal, filterable by bean, 30 at a
  time. Viewers don't get them.
- **What it fills** (`lib/repeatBrew.ts` `repeatPlan`, then `applyRepeat`):
  - bean;
  - what → drink/plain → brewer → recipe;
  - drink size;
  - dose and water (filter: the brew's own, so its ratio; espresso: its
    dose at the recipe's ratio);
  - temperature;
  - grinder, grind and RPM;
  - water profile.
  Each choice is set after the previous one's watcher has run, so a drink's
  default brewer or recipe doesn't win over the brew's. The repeated grind
  is kept while its grinder and recipe stay chosen (`grindSource
  'repeat'`).
- **Left blank:** prep tools (the "Choose what a repeat keeps" item can
  change that), beans in / grounds out, results, ratings and notes. The
  timer isn't started.
- **Gone since:** an archived bean is replaced by the newest active bag of
  the same coffee (roaster and name, e.g. the next batch), or left to pick.
  An archived brewer, recipe, drink, grinder or water profile is skipped.
  Setup says what was skipped under the buttons.

## Rate later, with reminders (built)

Backlog item "Rate later, with reminders", branch `rate-later`, migration
0056. Coffee is often rated a while after it's made, by which time the app
is closed. Contract: `api/notifications.md` §1b, `api/brew-logs.md` §6.

- **Notification channels** (per person, Settings → Notifications): ntfy,
  Gotify, Pushover, Discord, Telegram, Slack and a generic webhook. Each has
  its own on/off and **Send test**. Credentials come back masked
  ("••••1234"), and saving the mask keeps them. Stored in
  `notification_channels` (one per kind per person). Sending is plain JSON
  `POST`s in `@barista/shared/notify`, used by the backend (test) and the
  worker (reminders).
- **Rate reminders** (preferences): `rateReminders`, on by default, and one
  delay per person (`rateReminderMinutes`, 15). The switch is greyed out
  until a service is set up and on. When it's off, or nothing can deliver,
  the log form has no Rate later button.
- **Save, rate later** sends `remindToRate` with the new brew (unless a
  rating was entered after all). The backend queues a delayed BullMQ job
  (`reminders` queue). The saved screen says when the reminder will come,
  or why it couldn't be set, and leaves the AI suggestion for after the
  rating.
- **The reminder:** the worker skips it if the brew was rated or deleted, or
  reminders were turned off. Otherwise it sends "How was it? Rate your
  brew" ("V60 · Onyx Guji · 8:42") to each enabled channel, with a link to
  the entry (`APP_URL`, default `http://localhost:5173`). One failing
  channel doesn't stop the others.
- **Quick rating:** any brew without a rating shows a **Rate this brew**
  card on its journal entry: stars and notes, and the drink's for drinks
  with ingredients. Once rated it offers the AI suggestion, which waits
  until then. There's no separate list of brews waiting for a rating.
- **Server-side requests:** members can make the server `POST` to a URL
  they choose (their ntfy, Gotify or webhook), so it's http(s) only, without
  following redirects and reporting only the status. LAN addresses are
  allowed, since self-hosted services live there.
- **Follow-up (branch `rate-later-tweaks`):**
  - Rate later is a **box** on the log form instead of a second button.
  - The settings switch and the delay can always be changed. With
    reminders on but no service on, the box shows greyed out with a link to
    set one up.
  - A new `rateLaterDefault` preference sets whether the box starts ticked.
  - `docker-compose.yml` maps `host.docker.internal` into the backend and
    worker, so a self-hosted ntfy or Gotify on the same machine can be
    reached.

## Choose what a repeat keeps (built)

Backlog item "Choose what a repeat keeps", branch `repeat-keeps`, no
migration (a preference). What to carry over differs: some always change
the grind, others want last time's notes in front of them.

- **Settings → Repeat brews**, per person (under "You"): a box for each thing
  a repeat can copy. On by default: drink size, dose and water,
  temperature, grinder, grind and RPM, and water profile (what repeating
  did before). Off by default: the prep checklist (ticks the tools that brew
  used), beans in / grounds out, and the tasting notes, which are shown as
  a "Last time" card on the log form, not copied.
  "Back to the defaults" resets the list.
- Stored as `preferences.repeatKeeps`, the list of what's on
  (`REPEAT_KEEPS`). The bean and what → brewer → recipe always come along,
  and results and ratings never do.
- **What's left out** starts as for a new brew:
  - the drink's default size, the recipe's batch and temperature;
  - the grinder setup already had, with the usual grind pre-fill;
  - the default water.

  Notes about archived things are only shown for what would have been
  copied.
- Decided: per person, not per workspace.

## Cold brew refinements (built)

Backlog item "Cold brew refinements", branches `cold-styles` and
`cold-brew-steeping`, migrations 0057 and 0058. Cold brew was a style label:
a seconds timer, saved at once, no dilution, at most 24 h. Contract:
`api/recipe-styles.md` §5e, `api/recipes.md` §5, `api/brew-logs.md` §6,
`api/notifications.md` §1b.

- **Styles:** new built-in filter styles **Rapid cold brew** (`rapid_cold`,
  OXO-style, timed, immersion for extraction yield) and **Kyoto drip**
  (`kyoto_drip`, long, percolation). They're seeded after each workspace's
  last filter style. `LONG_STYLES` (cold brew, Kyoto drip) and `COLD_STYLES`
  (+ rapid cold) decide the flow, by `brewsLike`, so custom styles follow.
- **Recipes:** steep window in hours (a pair), fridge or room, and a serving
  dilution (1 : n with water, milk, ice…). Long styles hide the water
  temperature and finish window, and their steps are a checklist with no
  times.
- **Brewing a long style:** **Start steep** (steps checklist and fridge/room)
  saves the brew with `steeping: true`. The saved screen says when it's
  ready and whether a reminder is set.
  - The journal marks it **Steeping**. **Finish** opens the edit form with
    the time so far filled in (`h:mm:ss`; brew times now go up to 7 days),
    and saving clears `steeping`.
  - Quick rating and the AI wait until then; analyze is a `409` while
    steeping.
- **Dilution served** and **steeped in** are on the brew form for cold
  styles (field registry `brew.dilution`, `brew.steepTemp`). Repeat brews
  gets a `dilution` option (on by default), and `steepTemp` goes with the
  temperature.
- **Steep reminder:** `steepReminders` (default on) queues `steep-done` for
  the start of the window. The worker skips it once the brew is finished.
- **The AI** gets the cold fields, leaves steeping brews out of the history,
  and is told how the three styles differ, to judge strength after dilution
  and expect a concentrate's higher TDS.
- **Not built:** a cold brew batch as stock with servings taken from it
  (kept as an idea under "Ingredient prep and stock"), and iced /
  flash-chilled styles (their own backlog item).

## Brew windows (built)

Branch `brew-window`, migration 0059. A cold brew's window was the recipe's
alone, so a longer or shorter steep for one batch couldn't be planned.
Contract: `api/brew-logs.md` §6, `api/notifications.md` §1b.

- **On setup**, before starting: cold brew and Kyoto drip show the steep
  window in hours, rapid cold the target finish (m:ss), both filled from the
  recipe with a "Use it" link back. Fridge or room temperature moved to
  setup too, for all three cold styles.
- **The brew keeps it** (`steepMinHours`/`steepMaxHours`,
  `expectedFinishMinSec`/`expectedFinishMaxSec`, set on `POST` only, both
  ends or neither). The steep reminder, "Ready from", the journal and the AI
  use the brew's window; a steep sent without one takes the recipe's.
  Existing brews were backfilled from their recipes.
- Field registry `brew.window` and a Repeat brews option `window` (on by
  default).
- **Not built:** changing the window after the brew starts (the reminder
  would need re-queuing).

## Brew problems (built)

Backlog item "Brew problems", branch `brew-problems`, migration 0060.
Tasting notes said how a cup tasted, not what went wrong while brewing, and
free text couldn't be counted. Contract: `api/brew-problems.md` §6b,
`api/brew-logs.md` §6, `api/llm-contract.md` §9.

- **The list:** `brew_problems`, per workspace, ordered, each for one method
  or all, seeded with 23 defaults (filter, espresso, all methods) for new
  and existing workspaces. Edited in **Settings → Lists → Brew problems**
  (add, rename, reorder, method, archive, delete); `EditableList` got
  configurable wording so it says Archive / Restore here.
- **Decided:** archived like prep tools rather than hidden like the other
  lists (they leave the checklist, old brews keep them); any problem can be
  deleted, with the usual warning; no free-text "other" line (add one to the
  list instead).
- **Brews:** a Problems checklist on the log form and journal edit, filtered
  like the prep checklist (`toolsFor`), stored in `brew_log_problems`
  (`problemIds`, replaced on `PATCH`), shown on the journal entry. Field
  registry `brew.problems`; Repeat brews never copies them (`'result'`).
- **The AI** gets each brew's problems by name and is told they're the
  clearest clues, and that an empty list means none were recorded.
- **Not built:** charting problems over time (added to Statistics).

## Backup and restore (built)

Backlog item 1, part 1, branch `backup-restore`; no migration. The journal
had no copy and couldn't move to another server. Contract:
`api/backup.md` §2b.

- **The file:** `{ format, version, exportedAt, workspace, tables }`, every
  workspace table's rows as stored with their IDs (only links inside the
  file), `brewedBy` (email) instead of `userId`. People, members and
  notification channels aren't in it.
- **How it's built:** `BACKUP_TABLES` lists the tables in insert order and
  how their rows are found; which column points where comes from the
  schema's foreign keys (`getTableConfig`), and value checks from the
  column types, plus small `ENUMS` and `JSON_SCHEMAS` maps for varchar
  enums and JSON columns. Tests fail if a schema table is neither backed up
  nor in `NOT_BACKED_UP` (new `CLAUDE.md` rule 8), or points at a table
  below it.
- **Restore:** checked whole before anything is written (first problem as
  a 400 with its path), then one transaction: a new workspace without the
  default lists, new IDs everywhere, the self-reference (a drink's parent)
  filled in after, every brew the restorer's, the public menu off. Its own
  50 MB JSON limit (everything else keeps 100 kB); 413 above it.
- **Decided:** owners only for backup; restore only into a new workspace
  (no merging); AI analyses and marks included; restored brews belong to
  the person restoring.
- **App:** Settings → Data (Download backup; Restore), and a Restore card on
  the workspaces page for a new server with no workspace yet.
- **Not built yet:** CSV export and import/export by list (item 1 stays in
  the backlog for them).

## Export and import by list (built)

Backlog item 1, part 2, branch `list-import`; no migration. Sharing a few
recipes or beans with another bar, or bringing them into an existing
workspace, meant retyping them. Contract: `api/backup.md` §2b, "By list".

- **Same file as a backup**, with `scope: "lists"`: the chosen rows, their
  child rows, and everything they point at, found by walking the schema's
  references (`closure` in `listImport.ts`). Any backup can be imported a
  list at a time.
- **Import** plans the whole thing first (the preview is that plan, the
  import writes it in one transaction). `MATCH_KEYS` says when a row is
  "already here" (names, built-in keys, a bean's roaster + name + batch, a
  recipe's name + brewer, a brew's time + bean + dose); matched rows are
  reused, the rest added with new IDs.
- **Decided:** duplicates are a choice in the preview (use the one here, or
  add copies named "(2)"); copies are only of the chosen lists, never of
  what they need, and never of brews; exports include what items need;
  owners only.
- **App:** an Export bar on every list page (Export all, or "Select to
  export…": rows tick on tap; the journal's cards become buttons while
  selecting), and on Settings → Lists for brew problems; Settings → Data
  exports several lists and imports with a preview table.
- **Not built yet:** CSV export (item 1 stays in the backlog for it).

## CSV export (built)

Backlog item 1, part 3, branch `csv-export`; no migration. This finishes
"Backup, restore, import and export". Contract: `api/backup.md` §2b,
"CSV".

- `GET /:workspaceId/csv/brew_logs` and `/csv/beans` (owners): one row per
  brew or bean, names instead of IDs, the brew's local time beside UTC,
  ratio and extraction worked out, prep and problems joined with `; `,
  beans with their process and brew count.
- Spreadsheet-safe: RFC 4180, CRLF, a UTF-8 BOM for Excel, and a leading
  `'` on text that would otherwise run as a formula.
- The extraction rule moved to `@barista/shared/brew`, used by the CSV and
  the worker (the frontend keeps its copy in `lib/extraction.ts`).
- App: a Spreadsheet (CSV) card on Settings → Data, and a "Spreadsheet
  (CSV)" button in the Journal's and Beans' export bars.
- **What's left of the old item:** photos in backups is a note on bean
  photos; scheduled server backups is its own backlog item.

## Scheduled server backups (built)

Backlog item "Scheduled server backups", branch `server-backups`, migration
0061. Workspace backups were manual, and nothing covered accounts.
Contract: `api/server.md` §10.

- **Server admins:** a `users.is_admin` flag (migration 0062) granted only
  from the server (`npm run admin -- grant <email>`); the user object gains
  `isAdmin`, and admins get Settings → Server → Backups. A first draft used
  an `ADMIN_EMAILS` list, dropped before merging: with open sign-ups and
  unverified emails, anyone could register an admin address nobody had
  claimed yet. First server-wide setting:
  a `server_settings` table (key → JSON), left out of workspace backups.
- **Schedule:** off / daily / weekly at an hour in `BACKUP_TIMEZONE`, keep
  1–90. A BullMQ job scheduler on a new `maintenance` queue, synced on save
  and at backend start; "Back up now" queues a one-off.
- **The dump:** the worker runs `mariadb-dump` (mariadb-client added to its
  image) as the app's user, password via `MYSQL_PWD`, gzipped through a
  `.partial` file into `./backups` (bind-mounted; read-only for the
  backend, which lists and serves the files to admins), then prunes to the
  newest N and records the status or error.
- **Decided:** a whole-database dump set by admins (not per-workspace
  scheduled JSON); restored with a documented command, not in the app.
- **Not built:** an off-site copy, and notifying admins when a backup fails.

## AI review: input, output, and what the AI sees (built)

Backlog items "Review and refine AI input and output" and "Choose what the
AI sees", branch `ai-review`, migration 0063. The prompt and context had
grown a feature at a time: the documented prompt was far behind the code,
the test pinning it compared the prompt to itself, every context sent all
its null keys and repeated grinder, water and recipe details on all six
brews (~3k tokens), and the output (reasoning, grind direction, temp
change) invited RPM advice it couldn't hold. Contract:
`api/llm-contract.md` §9, `api/analysis.md` §8.

- **Measure first:** each `llm_analyses` row records its `model` and
  `prompt_version`, and 👍/👎 (`PUT …/analyses/:id/feedback`, on the
  suggestion card). `npm run eval -w worker` snapshots recent rated brews,
  runs them through the current input and prompt (real API calls, token
  counts recorded) and writes a side-by-side comparison to the git-ignored
  `eval/`.
- **A smaller input** (`worker/src/prompt.ts`): empty values dropped (the
  prompt says a missing key wasn't recorded), each grinder and water once
  under `equipment`, earlier brews marked `sameRecipe`.
- **The prompt in sections:** `core`, `output`, then `drink`, `style`,
  `tds`, `water`, `problems`, `rpm`, `espresso`, `cold`… each only when the
  input has what it's about. Tests check which sections appear and snapshot
  the assembled prompt.
- **Output:** `nextStep` (one concrete instruction), `confidence` (low /
  medium / high) and `suggestedRpmDelta` (variable-speed grinders only),
  shown as "Next time:" with a badge on the suggestion card and the brew
  page's Starting point. Prompt version `2026-10-b`.
- **Settings → AI** (owners; others view): a switch per detail, grouped by
  brew, bean, recipe and equipment, and history, stored per workspace as
  `aiHidden` (`AI_DETAILS` in `@barista/shared/aiDetails`). The worker
  leaves switched-off details out of the input and their sections out of
  the prompt. History switches: compare with unrated earlier brews, and
  analyze unrated brews at all (off: `409`, and the brew page asks for a
  rating first).
- **Decided:** switches per workspace, not per person; users rate
  suggestions to measure them; the model stays in Docker (`OPENAI_MODEL`);
  hiding a form field (Settings → Fields) still doesn't change what the AI
  gets.
- **Not done yet:** the `after` eval run against the baseline, to compare
  the new prompt on real brews and adjust wording if it reads worse.

## Auto-analyze and the analysis workflow (built)

Backlog item "Rework the analysis workflow, with auto-analyze", branch
`auto-analyze`, migration 0064. A suggestion only happened when someone
tapped a button, so many brews never got one, and a failed analysis just
left the page saying "still working". Contract: `api/analysis.md` §8
"Auto-analyze", `api/brew-logs.md` §6.

- **Settings → AI → Automatic analysis** (owners, per workspace): on/off,
  a wait of 5 / 10 / 15 / 30 minutes (10 by default), and no limit or up to
  N a day (1–500, counted over the last 24 hours).
- **When it runs:** a rated brew is queued as a delayed job when saved; the
  brew is read when the job runs, so edits in the wait are included, and
  deleting the brew removes the job. An unrated or still-steeping brew
  waits: the edit that first rates it (quick rate, Finish) queues it to run
  now, unless it already has a suggestion. Never-rated brews cost nothing.
- **Asking while it waits** promotes the waiting job (same job id) as an
  asked-for analysis, so the cap doesn't apply. Saved analyses record
  `llm_analyses.auto`; only those count toward the cap.
- **State on the brew:** `analysis_requests` (one row per brew, not backed
  up: queue state) holds when an automatic analysis is due and why the last
  one failed or was skipped; brew logs carry `analyzed`, `analysisDueAt` and
  `analysisError`.
- **App:** Journal cards show "Not analyzed" (with the reason on hover) or
  "AI at 9:15"; the entry says when it's due with Analyze now, shows a
  failure with Try again, and picks the suggestion up when it lands; after
  a quick rate it says the suggestion is on its way. The saved screen says
  the same. Polling stops with the reason once every attempt has failed.
- **Decided:** per workspace (it costs the workspace's API calls); unrated
  brews wait for their rating instead of running after the reminder; an
  optional daily cap rather than a cost limit.
- **Not built:** a history of earlier suggestions on the journal entry (it
  shows the newest), and pushing the job back when a brew is edited in the
  wait (not needed: the job reads the brew when it runs).

## Espresso dose and shot weight suggestions (built)

Backlog item "Espresso dose and yield suggestions from the AI", branch
`espresso-dose-yield`, migration 0065, prompt `2026-10-c`. The AI only
changed grind and temperature; for espresso the ratio is often the better
lever. Contract: `api/llm-contract.md` §9.

- **Output:** `suggestedDoseDelta` (grams, within ±5) and
  `suggestedYieldDelta` (shot weight in grams, within ±30), both rounded to
  0.1 g and nullable, stored on `llm_analyses`. The worker nulls them for
  anything but espresso, and a 0 counts as none (`onlyWhatApplies`, which
  also holds the RPM rule).
- **Prompt:** the espresso section explains the levers (a longer shot
  extracts more and tastes lighter, a bigger dose slows it like a finer
  grind) and asks for one at a time: a ratio change rather than a grind
  change when the grind is right but the cup is off.
- **App:** the suggestion card lists "Dose +0.5 g" and "Shot weight +4 g";
  the brew page's Starting point shows the new values ("→ 18.5 g") and
  "Suggest parameters" sets the shot's dose and the ratio for the new
  weight.
- **Decided:** pre-infusion and profile changes aren't fields; the prompt
  sends them to `nextStep` when the machine allows them.

## Flash chilled (built)

Backlog item "Flash chilled (brewed onto ice)", branch `flash-chilled`,
migration 0066, prompt `2026-10-d`. Iced coffee brewed hot straight onto ice
(Japanese iced) had nowhere to put the ice, so the ratio and the yield
estimate were off. Contract: `api/recipes.md` §5, `api/brew-logs.md` §6.

- **Data:** `recipes.target_ice_grams` and `brew_logs.actual_ice_grams`,
  filter only. `targetWaterGrams` / `actualWaterGrams` stay the hot water.
- **Ratio and yield:** the ratio is dose : (water + ice), shown as
  "15 g : 250 g (150 g water + 100 g ice · 1:16.7)"; the yield is the server
  weighed with the ice in, so the yield estimate and measured retention count
  the ice. Pour targets count the hot water only. Scaling a batch keeps the
  recipe's split of water and ice (or a repeated brew's, or one typed in the
  log form).
- **No TDS:** a brew with ice takes no TDS reading (the API refuses one) and
  has no extraction yield; the form greys TDS and Brix out.
- **App:** a "Flash chilled (brewed onto ice)" checkbox on the recipe form
  (not for cold styles) that shows the Ice field in place of the dilution
  (the checkbox is UI only: ticked means `targetIceGrams` is set), and the
  Ice field on the brew form for recipes with ice (a hideable field; Repeat brews copies it with the dose and
  water); CSV export has an Ice column.
- **AI:** brews send `actualIceGrams` and recipes `targetIceGrams`; the
  `flashChilled` prompt section says it's judged as served over ice.
- **Decided:** ice is a recipe field in grams, not an ingredient or a style,
  so a V60 onto ice still brews like pour over. A concentrate poured over
  ice afterwards is a separate thing (next).

## Concentrate (built)

Backlog item "Concentrate (brewed strong, then diluted)", branch
`concentrate`, no migration, prompt `2026-10-e`. A hot concentrate poured
over ice (or cut with water) afterwards had no way to say so outside the
cold styles, and unlike flash chilled its TDS is worth recording. Contract:
`api/recipes.md` §5, `api/llm-contract.md` §9.

- **No new data:** the cold styles' `dilutionRatio` / `dilutionWith` were
  already accepted on any recipe and brew. Any filter recipe with a serving
  dilution is a concentrate.
- **App:** the recipe form offers "Serve diluted" on every filter recipe
  that isn't flash chilled;
  the brew form asks for the dilution when the recipe has one or the brew
  already does, and labels the TDS "Concentrate TDS". Extraction yield works
  as usual, by the style's `brewsLike`.
- **AI:** a `concentrate` prompt section for brews that aren't a cold style
  and have a dilution: TDS and EY are the concentrate's, strength is judged
  as served (over ice, as an iced drink), and a well-extracted cup that's too
  strong or weak wants a different dilution or ratio, not a grind change.
- **Decided:** not a style (a style brews like only one built-in, so it
  couldn't also say pour over or immersion) and not a switch (it would only
  repeat "has a dilution").

## Tailored AI suggestions (built)

Backlog item "Tailor the AI suggestions", six branches (`ai-single-brew`,
`ai-suggest-parameters`, `ai-saved-request`, `ai-preview`, `ai-prompt-edit`,
`ai-alternatives`), migrations 0067–0070, prompts `2026-10-f` and
`2026-10-g`. Every analysis sent the brew plus the bean's last five brews,
and "Suggest parameters" reused the bean's newest analysis. Nobody could
pick what was compared, see what was sent, or change the prompt. Contract:
`api/analysis.md` §8–§8d, `api/llm-contract.md` §9–§9b, `api/auth.md` §1c.

- **One brew on its own:** an analysis (journal, auto-analyze) sends only
  that brew.
- **Suggest parameters is its own AI request** (`parameter_suggestions`):
  the barista picks the earlier brews (this bean, bean and recipe, bean and
  brewer, this brewer, this recipe; up to 1–20), each sent with its latest
  analysis. The AI returns a grind for the chosen grinder, a temperature and
  a ratio. The batch stays the barista's: espresso keeps the dose, a filter
  batch what was typed last (else the recipe's water).
- **What was sent** is saved with each analysis and suggestion, and
  **Preview what's sent** builds the same in the worker without calling the
  AI. Backups and exports leave it out unless asked.
- **Your own prompt, per person** (`users.ai_prompt`): instructions, and
  with Advanced any unlocked section's text. An analysis uses the brew's
  barista's prompt, a suggestion the asker's; a one-off note can go with
  either. Customized results are saved as `PROMPT_VERSION+custom`.
- **Alternatives:** Suggest parameters can also suggest another recipe or
  brewer for this bean, or another bean in stock for this recipe, from
  options sent by short ref. Tapping one switches the brew page to it.
- **Brew page:** the AI suggestion card sits above the batch, and the
  starting point shows from the start, with a line under Start/Log saying
  what's still missing.
- **Decided:** per person, not per workspace, prompts, so several people in
  one home can each tune it; no owner override. Batch size is never the
  AI's to change. "In stock" means not archived with weight left.

## Remember the brew setup (built)

Backlog item "Remember the last bean and recipe on the brew page", branch
`remember-setup`. The brew page remembered what you're making, the brewer
for each method and the grinder, but the bean and recipe started empty
every time. Contract: `api/auth.md` §1 `rememberSetup`.

- **Bean and recipe** are remembered too: the last bean (skipped once
  archived), and the last recipe on each brewer.
- **Settings → Brew setup** (was Repeat brews; `/settings/repeat`
  redirects) has a new **Remember from last time** section, a checkbox for
  each: what you're making, brewer, recipe, bean, grinder and grind (on by
  default, as before plus bean and recipe), and water profile, the prep
  checklist for each brewer and the drink size for each drink (off by
  default). The repeat options are its second section, unchanged.
- **Order:** a repeat, then a drink's default brewer and recipe, then
  what's remembered, then the first. A repeat that leaves something out
  starts it from what's remembered.
- **Decided:** the choice of what's remembered is a preference (per
  person, every device); the values stay per device and per workspace, as
  before. Dose, water, temperature, dilution and the window follow the
  recipe and aren't remembered (that's what Repeat is for). Making the bean
  and recipe Repeat options (backlog "Repeat brews: bean and recipe as
  choices") was set aside: it may not make sense.

## Step timings in the recipe builder (built)

Backlog item "Step timings: 'ends at' and the target window in the
builder", branch `step-timings`. Each step only said when it starts, so you
added up its time to see when it ends, and the target finish window was set
further up the form, out of view while building the steps.

- Each step says when it starts and ends: "Starts at 0:30 · Ends at 1:15",
  ≈ after a step that waits for a tap or first drop, "Runs until you
  finish" for an open-ended last step.
- A line under the steps: "Steps end at 3:15 · Target finish 3:00–3:30",
  in the warning colour when the steps end outside the window.
- `plannedTimes` / `plannedEnd` (`lib/steps.ts`) work out both, and the
  recipe list's step summary and the "window ends before the steps"
  warning use them too.
- Built alongside prep steps (recipe steps done before the timer starts),
  which were set aside unmerged on branch `prep-steps`. What to do when the
  steps and the window disagree stays on the backlog.

## Prep on brew setup (built)

Branch `setup-prep`. The prep checklist was only on the log form, after the
brew; it's done before. Prep steps as part of a recipe (branch `prep-steps`,
parked) were tried first and set aside in favour of this.

- Brew setup has a **Prep** card above Start: the prep tools for the
  recipe's method and the all-method ones, as on the log form.
- It's the same list of ticks as the log form's, so what's ticked on setup
  is there after the brew and can still be changed. Remembered prep
  (Settings → Brew setup) and Repeat fill it as before, now visibly.
- Hidden with the Prep field (Settings → Fields), like the log form's.

## Where each prep item is offered (built)

Backlog item "Where each prep item is offered", branch `prep-offered`. A
prep tool belonged to one method or to every method; a paper filter (top,
bottom or a sandwich) fits espresso and the OXO Rapid Brewer, not the V60.

- **Model:** `prep_tools.method_kinds` (a JSON list, replacing
  `method_kind`) and a `prep_tool_brewers` join table. A tool is offered
  for every brew when both are empty, else for brews of those methods and
  with those brewers. A brew without a recipe offers every tool, and a
  brew's own ticks always show. Migrations 0071 (add and backfill
  `[method_kind]` or `[]`, new table) and 0072 (drop `method_kind`).
- **API:** the tool object has `methodKinds` and `brewerIds`; POST and
  PATCH take both, brewers checked against the workspace. Brew logs' tool
  refs are now `{id, name}`.
- **Edit page** (`PrepToolFormView.vue`, Bar setup → Tools → Edit / Add
  tool): the name, and **Offered for**: Every brew, or method checkboxes
  and brewer checkboxes grouped by method (archived brewers only when
  already chosen). Delete moved there from the list's edit row; ↑/↓ and
  archive stay on the list, whose badge says where each is offered
  ("Every brew", "Espresso, Oxo Rapid Brewer").
- **Backups:** version 2. A version 1 file's `methodKind` becomes
  `methodKinds`; `prep_tool_brewers` restores after brewers, and a prep
  tool export brings its brewers along (matched by name on import).
- **Decided:** methods are the kinds (Espresso, Filter, Stovetop, Other),
  not the workspace's custom brewer methods. A deleted brewer drops off the
  tool; an archived one stays chosen. Brew problems keep one method for
  now (backlog: "What went wrong: offered by methods and brewers").

## Recipe default prep (built)

Backlog item "Recipe default prep", branch `recipe-prep`. A recipe usually
has the same prep (rinse the filter, WDT); it had to be ticked by hand each
brew, or remembered per brewer.

- **Recipe form:** a **Default prep** card lists the prep tools offered for
  the recipe's brewer; changing the brewer drops ticks it isn't offered.
  A field (`recipe.prepTools`) that can be hidden under Settings → Fields.
  Duplicating a recipe copies it.
- **Model and API:** `recipe_prep_tools` (recipe → tool, migration 0073);
  `prepToolIds` on the recipe, in checklist order, replaced as a whole on
  PATCH. Deleting a tool takes it off, and its delete warning counts the
  recipes. Backups restore it after recipes; a recipe export brings its
  prep tools along, matched by name on import.
- **Brew setup:** choosing a recipe ticks its default prep (active, still
  offered for its brewer); without any, what was last ticked with the
  brewer if remembered (Settings → Brew setup), else nothing.
- **Decided:** a repeat always ticks the repeated brew's prep, never the
  recipe's defaults, so prep left the "Copy when repeating" options
  (`REPEAT_FOR_FIELD` gained `'always'`); migration 0073 took `prepTools`
  out of saved repeat choices. The AI isn't told where a tick came from;
  it sees what was ticked, as before.


## Prep naming and checklist reordering (built)

Backlog item "Call it Prep, and drag to reorder", branch `prep-reorder`.
Tools now reads **Prep** across Bar setup, its editor, and data import/export;
individual entries are prep items. Existing URLs, API names, table names and
backup formats stay compatible. Contracts: `api/prep-tools.md` §3d,
`api/brew-problems.md` §6b.

- **Prep and brew problems** both have touch drag handles, handle arrow
  keys with focus retained and move announcements, and the existing ↑/↓
  buttons. Other Settings lists keep their existing controls.
- Changes save immediately through the existing reorder endpoints; a failed
  save restores the old order and shows the error. Viewers cannot reorder,
  nor can editors while saving, selecting Prep for export, or renaming a
  brew problem.
- Hidden archived Prep items keep their slots while the visible items move;
  showing archived items makes them movable. Brew problems already lists
  archived entries, and includes them in reordering.
- Offered-for tags always sit below the prep item name; Archive/Restore
  lives on its edit page alongside Delete.
- Both lists share `composables/useReorder.ts` (optimistic move, revert
  on a refused save, announcement, handle refocus). A refused drag puts
  the row back on screen too. Every Settings list reloads one way:
  EditableList awaits its `reload` prop after each change, and a parent
  that locks around the list (Brew problems' import) uses `v-model:busy`.
- No schema migration or backup-version change.

## Delay before the timer starts (built)

Backlog item "A delay before the timer starts", branch `timer-start-delay`.
Contract: `api/auth.md` §1 `startDelays`, `timer_architecture.md` §3.

- Settings → Brew setup → Timer start: no delay / 3 seconds / 5 seconds,
  separately for Filter, Espresso, Stovetop and Other, per person. Custom
  methods use their underlying type. Default off: a type not set has no
  delay.
- Tapping Start on the timer shows a countdown; Start now skips it. The
  countdown is excluded from brew time and marks; step cards and recording
  controls appear at zero, with a short beep/vibration where allowed.
- Decided: applies to espresso and every other timed brew, including a
  stopwatch; long cold brews and logging without a timer skip it. Wake lock
  starts with the countdown; Cancel brew or unmount clears pending work and
  releases the lock. Deadline-based timing tolerates background throttling.

## Compare with: this bag or this bean (built)

Branch `compare-bag-bean`. Contract: `api/analysis.md` §8b sources,
`api/llm-contract.md` §9b, `api/backup.md` §2 (version 3).

- Suggest parameters' **Compare with** offers This bag, This bag and recipe
  and This bag and brewer (this exact bean record, one bag) and This bean,
  This bean and recipe and This bean and brewer (every bag of the coffee:
  same roaster and name, whatever the roast date or batch), plus this
  brewer's or this recipe's with any bean.
- Decided: keep the behaviour. The old `bean…` sources always meant the
  exact bag, so migration 0074 renamed them `bag…` in saved suggestions and
  workspace settings, and a workspace on the default got `bagRecipe`.
  Backups go to version 3 the same way, and the brew page's choice
  remembered on a device moved to `compareWith`, an old one read as the
  bag. New workspaces default to `beanRecipe`, every bag.
- The AI gets `sameBag` beside `sameBean` (now this coffee). Another bag's
  brews name the bag (roast date, batch) and its own roast age, and the
  prompt says they carry over allowing for roast age. A barista's own
  edited "What to do (Suggest parameters)" text keeps its old wording.

## Roast weight loss (built)

Backlog item "Roast weight loss", branch `roast-weight-loss`. Contract:
`api/beans.md` §4 `roastWeightLossPercent`, `api/llm-contract.md` §9.

- An optional bean field, **Roast weight loss (%)**: the green weight lost
  in roasting, above 0 and at most 40, one decimal place
  (`beans.roast_weight_loss_percent`, migration 0075). Hideable under
  Settings → Fields (`bean.weightLoss`). The bean list's details show it
  ("14.5% roast loss"), and the beans CSV has a "Roast loss (%)" column.
  Backups pick it up as a new column; it's not on the public menu.
- Decided: the % only, not green and roasted weights (what roasters print).
  It's one bag's roast, so Duplicate leaves it out, like the roast date.
- The AI sees it, switchable under Settings → AI (`weightLoss`). A prompt
  section explains it measures roast development (about 11–13% light,
  14–16% medium, 17%+ dark), that a more developed roast extracts more
  easily, and that it's trusted over the roast level when they disagree.
  PROMPT_VERSION 2026-10-i.
- The home roasting roast log will fill it in when built.

## Scale slider on the brew page (built)

Backlog item "Yield scaler slider on the brew page", branch `yield-slider`.
`docs/features.md` (Scale slider), `frontend/src/lib/scale.ts`
(`SCALE_SLIDER`).

- Brew setup's "Batch and starting point" card has a **Scale the recipe**
  slider above the batch, for filter and espresso: ×0.5 to ×2 in steps of
  0.05, labelled with the multiplier ("×1.5").
- It sets the dose to the recipe's × the factor (to 0.1 g) at the ratio as
  it is (a custom ratio included), so water and ice, the yield estimate or
  the shot weight, and the pour targets follow, as does the AI
  suggestion's batch. Typing an amount moves it to match; past either end it
  stays there and the label says the real factor.
- Decided: the drink size stays (the size is the cup, the batch is what's
  brewed); multiplier only in the label, not the yield.
- Hideable under Settings → Fields (`brew.scaleSlider`); a repeat copies
  the dose and water it set (`doseWater`). Nothing new is stored.

## Step times that scale with the batch (built)

Backlog item "Scale step timing with the batch", branch `step-timing-scale`.
`docs/api/recipes.md` §5 (Step times with the batch), `docs/features.md`.

- `recipes.step_time_scaling` (migration 0076), nullable, above 0 up to 1,
  2 decimals; `null` = step times stay the same. Not for espresso (`400`).
- A scaled batch (water ÷ the recipe's = the factor) gives `pour` and `wait`
  steps time × factor^stepTimeScaling, to the second; bloom, swirl, stir,
  press and other keep theirs. The target finish window moves by the
  seconds they gained or lost. Worked out the same way in
  `@barista/shared/brew` (worker) and `frontend/src/lib/scale.ts`
  (`scaleStepTimes`, `shiftWindow`); nothing scaled is stored.
- Recipe form: "Step times scale with the batch" checkbox in the steps card
  (any method but espresso; not long steeps), then a **Scaling factor** box
  (0.5 to start) whose hint shows a double and a half batch's 1:00 step.
  Hideable (`recipe.stepTimeScaling`).
- Brew page: the timer and its finish window use the scaled times; the
  batch note says "pour and wait times follow (+0:37 in all…)".
- Decided: per recipe, the user picks the exponent (not a fixed strength);
  only pours and waits scale; the window shifts rather than stretches;
  filter only. The AI gets the scaled times it was timed against (analysis:
  the brew's water; Suggest parameters: the batch asked with) plus
  `stepTimeScaling` under the `recipeSteps` switch, with a `stepTimes`
  prompt section. PROMPT_VERSION 2026-10-j.

## Bean photos (built)

Backlog item "Bean photos", branch `bean-photos`. `docs/api/bean-photos.md`
§4c, `docs/api/backup.md` §2b, `docs/features.md` (Beans).

- `bean_photos` (migration 0077): up to 6 per bean, `position` 0 the cover,
  width and height. Files at `PHOTO_DIR/<workspaceId>/<id>.webp`
  (`./photos` mounted at `/photos` on the backend).
- **One size only** (decided: no original kept): sharp turns it upright
  (EXIF orientation), fits it inside 1024 px, WebP q80, no metadata.
  Upload is the image as the body (≤ 15 MB); HEIC isn't read.
- Routes under `…/beans/:beanId/photos` (`backend/src/routes/beanPhotos.ts`):
  upload, get (cached for good: a photo never changes), make cover,
  delete. Beans carry `photos`. Deleting a photo, bean or workspace removes
  files after the commit; the backend sweeps orphans on start.
- Bean form: Photos card (Take photo with `capture`, Choose photos), make
  cover, remove (plain: nothing else uses a photo); a new bean uploads them
  once saved, and on a failed upload carries on as an edit. Bean list:
  cover beside the name, a strip in the details, tap for large. Hideable
  (`bean.photos`). A Duplicate starts without photos. PWA `CacheFirst`
  (`bean-photos`, 200 entries).
- Backups (decided: optional zip): a JSON file has no `bean_photos` rows;
  "Include bean photos" downloads a `.zip` (`backup.json` +
  `photos/<id>.webp`, `backend/src/backupZip.ts`, fflate). Restore takes
  either; zip photos must be WebP inside 1024 px and are written inside the
  restore transaction. Scheduled DB dumps don't cover `./photos`
  (`server.md`).
- Later (backlog): read the label from the photo with AI (built next).

## Read the bean label from its photos (built)

Backlog item 3, branch `bean-label`. `docs/api/bean-label.md` §4d,
`docs/api/llm-contract.md` §9c, `docs/features.md` (Beans).

- Decided: the photos are **taken for the read and thrown away**, in a
  "Fill in from a photo" card at the top of the form (first built on the
  bean's own photos; changed so a back-of-the-bag shot needn't be uploaded
  and deleted), up to 6 in one request;
  **fill empty fields, suggest for filled ones** ("Label says: X · Use");
  **match** the process to the workspace's visible ones (an enum in the
  schema), the growing area from the country, the roast to the workspace's
  roast scale; its **own switch** (`readLabels`, Settings → AI, on by
  default). No migration: settings are JSON.
- The photos travel **with the request**: the browser shrinks them to 1024 px JPEG, the backend re-encodes
  them with `processPhoto` (no EXIF), queues a `label-read` job and waits
  for its return value (`addAndWait` in `backend/src/queue.ts`, shared with
  the previews; `LABEL_READ_TIMEOUT_MS`, default 60 s). Nothing is stored;
  not retried. `502` when the AI call fails.
- Worker `worker/src/label.ts`: fixed prompt (not "Your AI prompt": it's
  reading, not judging), one `image_url` part per photo, strict schema,
  then each value checked on its own (`.catch(null)`) so one bad value
  doesn't lose the rest. `OPENAI_VISION_MODEL`, else `OPENAI_MODEL`.
- Frontend: `lib/labelFill.ts` (pure, tested) turns the answer into fills
  and suggestions in the form's terms; a process not in the list goes to
  the notes. Filled or suggested hidden fields are revealed.
- Refined after trying it (branches `photo-card`, `label-card`): the
  **Photos card at the top** of the form, then a **Fill in with AI** card:
  photos just for the read (thumbnails, not kept, sent first) plus "Also
  read the bean's photos" (ticked), up to 8 (`LABEL_MAX_IMAGES`); nothing is
  read until the button. Photos are **dragged to reorder**
  (`PUT …/photos/order`, `useReorder` + vue-draggable-plus); the first is the
  cover. A phone reloading mid-read was Vite's live-reload socket (off in
  Docker: `VITE_LIVE_RELOAD`).
- Its prompt is part of "Your AI prompt" (branch `label-prompt`): the
  `labelCore` section (editable under Advanced) and separate label
  instructions (`labelInstructions`), the asker's; brewing instructions
  aren't sent with it. The Docker dev server now refuses websocket requests
  outright (a hanging one, reset by a phone, crashed it).
- **Web lookup** (branch `label-web`), decided: opt-in per workspace
  (`labelWebLookup`, off by default) and then per read ("Also look it up on
  the web", unticked, noting it takes longer); web values are **only ever
  suggestions** with a source link; the **roaster's site first**
  (`allowed_domains` when its address is known). A second call after the
  label read, on the Responses API with `web_search`; the photos aren't
  sent to it, nor the roast date or batch number. A value is kept only with
  a page the search really visited (no invented links). A failed lookup
  still returns the label (`webError`). `LABEL_WEB_TIMEOUT_MS` 120 s;
  `OPENAI_WEB_MODEL`.
- After trying it (branch `label-read-away`): leaving the form (to start a
  timer) lost the read, though the server finished it. The read now runs
  in a store (`stores/labelRead.ts`) with a notice under the header and is
  applied when the form is back; an unsaved Add bean is kept in memory
  (`stores/beanDraft.ts`, "Picked up where you left off · Start over").
  Decided against keeping reads across a reload (a server-side read id):
  moving around the app was the need. Also: earlier "Web says" stay across
  reads, a late answer from an older read is ignored, and the web step
  asks for the product page with `search_context_size: "high"` (two runs had
  found the product page once and only the home page once).
- Branch `web-context`: the search depth is a workspace setting,
  `labelWebContext` (low, medium, high; default high), shown under the web
  lookup switch; "source · Use" under a field no longer splits across lines.

## Suggest roasters and coffees while typing (built)

Backlog item 3, branch `bean-name-suggestions`. Frontend only:
`lib/nameSuggest.ts` (pure, tested), `components/NameInput.vue`.

- Decided: a **custom dropdown**, not a `<datalist>` (it filters and looks
  different per browser, and iOS shows it poorly); on the bean form's
  **roaster, coffee, producer and green supplier** fields.
- The names come from the bean list the form already loads (it includes
  archived beans; `beans.md` §4), so no `/beans/names` endpoint. A blank Add
  bean now loads the list too, without waiting for it; editing leaves the
  bean itself out.
- Ranking: starts with, then a word starts with, then contains (from two
  letters), then a typo away (none under 4 letters, 1 under 8, else 2, on
  what's typed so far). Exactly what's typed isn't offered. The coffee field
  puts the typed roaster's coffees first.
- "**You have: X · Use**" (the `LabelHint` look) under a roaster,
  producer or supplier that's an existing name spelled differently:
  case, accents, punctuation, trailing filler words ("Coffee", "Roasters",
  "Lab", "Co" …; never the first word), a typo, or more words after it
  ("Proud Mary Melbourne" for "Proud Mary"; whole words, the shorter name
  at least 5 letters). It shows while typing too, unless the list already
  offers that name (first built only after leaving the field, which hid it
  when typing a longer name). A label read's roaster gets it too. Not on the coffee name, where one letter can be another
  coffee ("Kenya AA" / "Kenya AB").
- A new bean whose roaster and coffee match one you've had offers "**Start
  from your last bag**" (latest by roast date, else added), which fills
  the form as Duplicate does.
- Same branch, for the label read: the **pages the web lookup looked at**
  are listed under the card (`webSources`), to look by hand for what it
  missed (often the altitude). The lookup is now **its own request**
  (`POST …/bean-label/web`) after the photos, not part of the same job:
  both had to finish within the one 120 s wait, so a slow read left the
  search less time and a timeout lost the label too. A **Look it up on the
  web** button runs it alone from what the form says (again, or without
  photos). Its failure message now tells "the provider doesn't do web
  search" from "didn't work this time", and the worker logs each lookup
  (time, site, pages seen, found) to see why one finds nothing.

## Coffee varieties and species (built)

Backlog item "Coffee varieties (Bourbon, Typica, Geisha…)", branch
`bean-varieties`. Contract: `api/beans.md` §4 `varieties` / `species`,
`api/menu.md` §7b, `api/public-menu.md` §7, `api/bean-label.md` §4d,
`api/llm-contract.md` §9 and §9c.

- Two bean columns (migration 0078), JSON lists: `varieties` (free text,
  1–20 names of up to 100 chars, each once ignoring case) and `species`
  (`COFFEE_SPECIES`: arabica, robusta, liberica, excelsa, eugenioides,
  stored in that order). An empty list is stored as `null`. Backups and
  the list import take them as JSON columns (`JSON_SCHEMAS`); the beans
  CSV has "Varieties" and "Species".
- Decided: free text with suggestions rather than a managed list under
  Settings → Lists (no table, and the spelling suggestions already exist).
  Species as a multi-pick, not a single choice, since a blend like an
  arabica/robusta espresso has several.
- Bean form: **Variety** is chips with a box to add more (`NamesInput`):
  Enter, a comma or a picked suggestion adds one, × removes it.
  Suggestions are the workspace's varieties, then a built-in list of
  common ones (`lib/varieties.ts`). **Species** is toggle chips. Both
  are hideable (`bean.varieties`, `bean.species`); a Duplicate keeps them.
  `NameInput` now emits `pick`, and binds its attributes after its own
  listeners so a parent's keydown can see a suggestion took Enter.
- Bean list: details show "SL28, SL34 · Arabica"; the Show filter gets
  a Variety group (each variety once) and a Species group, as optgroups
  (`ListControls` takes an option `group`); Sort by has Variety (the first
  one).
- Label read and web lookup fill both (`LabelFields`,
  `LABEL_WEB_FIELDS`, the label prompts); the form holds them as text for
  the fill, so a differing list is one "Label says" suggestion.
- Public menu: a `variety` detail (both columns). The guest page adds the
  varieties to the origin line, and the species as a badge unless it's
  arabica alone.
- The AI sees both, switchable under Settings → AI (`variety`), with a
  prompt section treating them as context. PROMPT_VERSION 2026-10-k.

## Insights (built)

Backlog item "Statistics and graphs", branches `stats-foundation`,
`stats-tabs` and `stats-explore`. Contract: `api/stats.md` §11.

- An **Insights** item, last in the nav (`/insights`; "stats" in the code
  and the API). One view (`StatsView`) holds the filters and the data;
  each tab is a child route, so switching tabs doesn't fetch again.
  Tabs: Overview, Brews, Beans, Methods, Recipes, Prep, Grinders,
  Explore. Prep and Grinders leave the tab row when the workspace hides
  the prep checklist or the grinder (Settings → Fields), as do charts of
  other hidden fields (TDS, problems, grind setting).
- **Filters**, kept in the URL with defaults left out: period (30 days,
  90 days, a year, all time, or custom dates), bean, recipe, brewer,
  group by (auto, day, week, month), volume unit (starts from the
  person's), and **Only mine**, ticked by default (`mine=0` in the URL
  shows the whole workspace).
- **Chart periods:** every over-time chart (Brews: running total, per
  day/week/month, volume, coffee ground, rating; Beans: spend; Methods,
  Grinders and Prep tools over time) has its own period picker, "Page
  period" until changed, kept in the URL as `p.<chart>=30d` (or
  `from~to` for custom dates). The tab links leave these out, so a
  chart's period resets on switching tabs. The fetch widens to cover every chart's period,
  and the rest of the page is cut back to its own on the client.
- **Extraction against rating** (Brews tab, hidden with TDS): rated
  brews with an extraction yield, filter and espresso/moka as separate
  series, the 18–22% band shaded, and the average rating in and outside
  the band in the note. No trend line: the expected shape is a peak, not
  a slope.
- **Bars or line:** the over-time bar charts (brews per day/week/month,
  volume, coffee ground, spend, methods and grinders over time) switch
  to a line; each chart remembers its choice in this browser
  (`localStorage`, `insights.chartKind.<chart>`).
- **Data:** one endpoint sends a compact row per brew, every bean with
  its freezes and photo count, and id → name lookups (archived included,
  recipes with their finish window). The date range is the brew's
  **local** date: the API pads the UTC window by 14 hours in SQL and
  checks the shifted date exactly. Steeping brews are left out. Decided
  over server-side totals: Explore needs a point per brew, buckets need
  the local date, and the client helpers (`extractionYield`,
  `effectiveRoastAge`, `estimateYield`) get reused. The sums are in
  `lib/stats.ts` and `lib/explore.ts`, both tested.
- **Counting rules** (also in `api/stats.md`):
  - Volume drunk: a drink's size (the brew's, else the drink's default),
    else the measured yield, else the estimated yield; served diluted
    counts as yield × (1 + ratio). 1 g = 1 ml; totals with an estimate
    show "≈".
  - Money spent: bag prices per currency by purchase date (else the date
    added), never converted. Charts use the currency most bags were bought
    in and name the others.
  - Beans available: active with stock, as frozen (an open freeze), thawed
    (frozen before) or fresh. Bean charts count every bean unfiltered;
    with a filter, the beans it brewed.
  - Countries: a blend's list counts under each (split on , ; / & +, not
    "and", so "Trinidad and Tobago" stays whole).
  - Finish window: the brew's own (rapid cold), else its recipe's.
- **Charts:** Chart.js 4 (`components/charts/StatsChart.vue`: line, bar,
  doughnut, scatter), only loaded with the Insights page. Eight series
  colours (`--series-1…8` in `base.css`, light and dark), checked for
  colour-blind separation against `--surface` in both themes: never
  reorder or cycle them. Three are under 3:1 contrast on white, so every
  chart card has a **Table** view (`ChartCard.vue`). Pies keep the top 7
  plus a grey "Other"; scatters colour at most three groups.
- **Explore:** any number against any other (results: rating, drink
  rating, EY, TDS, volume; brew & bean: dose, water, ratio, temperature,
  grind setting on one grinder, brew time, roast age, altitude), never a
  field against itself, with a ⇅ swap. Groups (process, roast level,
  country, origin, species, roaster, method, brewer, recipe, style,
  grinder, prep tool, problem, weekday) go on the Compare side only. Two
  numbers are a scatter with a least-squares trend line, r and a
  plain-words strength ("a moderate positive link"), plus an optional
  colour by; the note says when one is worked out from the other (EY from
  TDS, dose and water; ratio from dose and water). A group is a bar of
  averages with n. The picks are in the URL (`x`, `y`, `color`,
  `grinder`), and the filters keep them.
- **Added charts** (`docs/api/stats.md` §11b): Explore's "Add to a tab…"
  keeps the current picks on a tab of the person's choosing (the Overview
  included), at the end of its charts with a Remove button. Every built-in
  chart has a pin that adds it to the Overview, or takes it off, from its tab
  or from the Overview. The Overview draws pinned charts below the tiles by
  drawing their own tab with only those charts showing (`ONLY_CHARTS`), so
  periods and bar/line work as on the tab. They show in tab order, then the
  Explore charts in the order they were added. The list is each person's
  own, per workspace, on their membership, and isn't in backups.
- **Layout:** every tab but Explore has **Edit layout**: its charts by title
  to drag (touch too, as prep items) or move with the arrows, a Show box per
  built-in chart, Remove for added and Overview-pinned ones, Reset tab and
  Done. Each tab's layout is its own (hiding a chart on Brews leaves its copy
  on the Overview). Saved per person on the membership (§11b), a pause after
  the last change. The charts take their place with CSS `order` in the tab's
  grid, so the templates don't change; a screen reader still reads them in
  template order (the editor's list is in the real order). With charts
  hidden, the tab ends "N charts hidden · Edit layout".
- **Overview layout:** the editor has two lists, Tiles and Charts. Tiles
  drag and hide among tiles (`tile.<key>`), staying in their compact grid,
  and "Tiles below the charts" moves the whole block. Charts drag among
  charts and are removed rather than hidden. Reset Overview puts it all
  back.
- **Nav:** seven links no longer fit a 320px phone, so the row scrolls on
  the smallest screens.

## Crop photos (built)

Backlog item "Crop photos", branch `crop-photos`. Contract:
`api/bean-photos.md` §4c (`PUT …/photos/:photoId/image`), `api/bean-label.md`
§4d.

- A **crop** button on each photo in the bean form's Photos card, and on the
  photos taken just for a label read. It opens `PhotoCropDialog.vue`: full
  screen, on **Cropper.js 1.6** (picked over our own box for pinch-zoom and
  touch handling), loaded only when it first opens (a ~12 KB gzip chunk).
- Tools: a free box by default with a **Square** toggle (for the list's
  square cover), quarter turns left and right, Reset. Done hands back a
  full-size JPEG (0.92); the server or the label read shrinks it as before.
- **A photo not yet uploaded** (a new bean's, or a label-read one): the
  cropped file takes its place in the list (`lib/photoCrop.ts`
  `replaceFile`, same key, so the order and the Add bean draft hold).
- **A saved photo** is replaced in place by the new endpoint: a new id at
  the same position (images are cached `immutable` by id), the old file
  removed, in one transaction under the bean's lock, so it works on a full
  bean of 6. Rejected: POST + reorder + DELETE (a full bean gets 409, and
  it isn't one step). Only the 1024 px copy is kept, so a second crop starts
  from that.
- No "I understand" confirmation (CLAUDE.md rule 7, asked): Done is a
  deliberate step and says "Replaces the saved photo".

## Home roasting: roast mode, roast log, resting (built)

Backlog item "Roasting: green stock, roast logs, resting", three branches:
`roast-mode`, `roast-log`, `roast-resting`. Contracts: `api/workspaces.md`
§2 (`homeRoasting`, `homeRoasterName`, `restDays`), `api/roasting-machines.md`
§3f, `api/green-coffees.md` §4e, `api/roasts.md` §4f, `api/notifications.md`
§1b (rest reminders, low green stock). What's next is in the backlog's
Home roasting section.

- **Its own mode**, not part of Beans and not a separate workspace: a
  **Brew | Roast** switch in the header when the workspace turns on Home
  roasting (Settings → Defaults). Roast mode lives under `/roast/…`, with
  the tabs Roast, Roasts, Green, Resting and Roasters; each device
  remembers the last mode and page (`lib/mode.ts`).
- **Green stock** (`green_coffees`): origin, producer, process, supplier,
  price, weight bought and left, a low-stock threshold. **Roasters**
  (`roasting_machines`), archived like grinders once roasts use them.
- **Saving a roast creates its bean** (roaster = the home roaster name, the
  local roast date, weight loss, levels, the next batch number, its share
  of the green price) and takes the green weight off the stock, never more
  than is left. Editing the roast keeps its bean and the stock in step;
  deleting it gives the green weight back and keeps the bean. Times are
  typed in; a live timer comes later.
- **Rest:** a workspace default per roast type, which each roast starts from
  and can change. Since "Resting beans" (below) the rest is the bean's: a
  new roast adds its bean to Beans → Resting, and Roast mode's Resting tab
  and the one-off `rest-done` reminder are gone.
- **Low green stock** (`green-low`, preference `greenStockAlerts`): a push to
  whoever saved the roast, once each time a roast takes a green coffee
  below its threshold, plus a notice on the roast's page and the Green
  tab's Low / None left badge.
- Deleting a roast uses the plain confirm dialog; whether it needs the "I
  understand" checkbox (CLAUDE.md rule 7) is still an open question in the
  backlog.
- No roast details for the AI yet (backlog: Roast details for the AI).

## Hold a step on the timer (built)

Backlog item "Hold a step on the timer", branch `hold-step`, no migration.
`docs/timer_architecture.md` §3, `docs/api/brew-logs.md` §6.

- **Hold** on the current step card for `auto` and `auto_log` steps with a
  duration (tap and first-drop steps wait anyway). The countdown stops at
  what was left ("Held · +0:12"), the progress bar with it; **Resume**
  carries on, **Next** ends the step now. A step can be held more than once.
- Recorded as marks: `step_hold` / `step_resume` with the step's
  `stepOrder` (and a `step_end` for Next), added to `MARK_KINDS`. The kind
  column is a varchar, so no migration; backups take them with the other
  marks. Per step they alternate, starting with a hold, each later than
  the last, at most 10; the last may stay open (Next, or finished while
  held). `brewSchedule` stays a pure function of steps, time and marks:
  a held step ends later by the time held, and later steps follow.
- Shown on the Previous card ("held 0:12"), the log form ("Pour held
  0:12") and the journal ("Step 2 held", a total per step).
- The AI gets them in `marks` (already switchable under Settings → AI), and
  a `heldSteps` prompt section says what they mean. PROMPT_VERSION
  2026-10-l.
- Decided: Hold / Resume / Next rather than "+15 s" (it records how long it
  really took); no pause for the whole brew (the coffee keeps brewing, so
  `actualTimeSec` stays the real time); the target finish window doesn't
  move, so a held brew shows as slow.

## Half-step ratings (built)

Backlog item "Half-step ratings", branch `half-ratings`, migration 0083.
`docs/api/brew-logs.md` §6, `docs/api/beans.md` §4, `docs/api/workspaces.md` §2.

- Brew `rating`, `drinkRating` and the bean's `rating` take 0.5 steps from
  0.5 to 5: `decimal(2,1)` columns, so existing whole stars carry over. The
  API refuses anything finer (`ratingSchema`).
- A workspace setting, `ratingStep` (`half` by default, Settings →
  Defaults → Ratings), picks how they're entered: half stars (the left half
  of a star is the .5 below it) or whole stars, 1–5. Input only: the API
  takes halves either way, and half ratings recorded earlier still show.
- Half stars show everywhere ratings do (`RatingStars`). Insights' averages
  already worked on plain numbers; the rating axes now start at 0.5 (0 on
  scatter plots).
- The AI's `ratingScale` is `"0.5-5"` and the prompt says "Ratings are 0.5-5
  in half steps". PROMPT_VERSION 2026-10-m.
- Backups: no new `BACKUP_VERSION`. A v3 file restores as is (whole numbers
  are valid decimals), and the version only changes when an older file
  can't.
- Decided: brews and beans alike; 0.5 allowed as the lowest; a workspace
  setting rather than always half.

## Flavor wheel (built)

Backlog item "Flavor wheel for tasting a brew", branch `flavor-wheel`,
migration 0084. `docs/api/brew-logs.md` §6, `docs/api/llm-contract.md` §9,
`docs/api/backup.md` §2b.

- A fixed lexicon, `FLAVORS` in `@barista/shared/flavors`: 9 categories →
  26 groups → 86 descriptors (121 keys), each key a dotted path
  (`fruity.berry.blueberry`). Our own wheel and colours on the common
  tasting vocabulary, not the SCA/WCR artwork (its design is copyrighted).
  The frontend keeps the same list with its colours
  (`frontend/src/lib/flavors.ts`, a test checks they match). Keys are
  stored, so labels can change but keys can't.
- Brews get `flavors` (keys, any ring, in wheel order), stored in
  `brew_log_flavors` so they can be counted later; `tastingNotes` stays
  alongside. Replaced on `PATCH`; an unknown key is a `400`.
- The log form, between the rating and the notes (and the journal's
  quick rating): an SVG wheel showing two rings around a centre. Tap a
  segment to zoom into it, tap the centre to pick it; an outermost flavor is
  picked straight away. Picks show as chips. There's a search box and a
  plain list view (remembered per device) for anyone who'd rather not use
  the wheel, and for screen readers. The journal shows the picks as
  coloured chips; the CSV export has a Flavors column.
- Field registry `brew.flavors`; Repeat brews `'result'` (tasted each
  time, never copied). Backups take `brew_log_flavors` (checked against
  `FLAVOR_KEYS` on restore), no new `BACKUP_VERSION`.
- The AI always gets them, with the tasting (not switchable), as labels
  with their place ("Blueberry (Fruity › Berry)"), and a `flavors` prompt
  section says how to read them. PROMPT_VERSION 2026-10-n.
- Decided: coffee only (the drink tasting keeps free text); just picked,
  no intensity (backlog item 7 reviews that later); the wheel keeps its
  off flavors (papery, rubber…) alongside brew problems: problems are what
  went wrong, flavors what's tasted; full three rings with zoom rather
  than stopping at the middle ring on small screens.

## Your own flavor wheel (built)

Follow-up to "Flavor wheel", branch `custom-lexicon`, migration 0085.
`docs/api/flavor-lexicon.md` §2c, how to build one:
`docs/custom-flavor-wheel.md`.

- A workspace can replace the built-in wheel with its own **lexicon file**:
  JSON, `format: "barista-flavor-lexicon"`, `version: 1`, a name and up to
  500 flavors (`key` with dots for rings, up to three; `label`; optional
  `#rrggbb` `color`), in wheel order, each after its parent.
  `parseLexicon` (`@barista/shared/flavors`) checks it for the API and
  restores, naming the first problem and where it is.
- `flavor_lexicons` (one row per workspace, none = built-in); `GET` for
  members, `PUT` / `DELETE` for owners. Settings → Lists → **Flavor wheel**:
  download the current wheel as a starting point, import a file, go back
  to the built-in one; both confirm with "I understand" (they change the
  wheel for everyone). The card
  has a short format summary.
- Picks now store their **label at the time** (`brew_log_flavors.label`,
  backfilled from the built-in wheel), so changing the wheel never loses a
  tasting: a pick the wheel no longer has shows (and goes to the AI) by its
  saved label, after the others, uncoloured; new brews can't pick it,
  editing a brew can keep it. The API now returns picks as
  `{ key, label }`.
- The frontend builds the wheel from whichever lexicon the workspace has
  (`buildWheel`, cached per workspace by `useFlavorWheel`), working out
  shades and dark-or-white text for any colour.
- Backups carry the wheel in the `workspace` block (`flavorLexicon`); list
  export/import doesn't. No new `BACKUP_VERSION`: older files have no
  wheel, and their picks without labels take the built-in ones.
- `scripts/flavor-lexicon-from-csv.mjs` builds a file from a CSV
  (`ring1,ring2,ring3,color`, one flavor per row) and checks it.
- Decided: the repo ships no lexicon but its own. Published wheels (the
  SCA/WCR one is, as far as we know, non-commercial and no-derivatives)
  don't fit AGPL, so users build their own
  files from whatever source they choose, outside the repo (`lexicons/`
  and `*.flavor-wheel.json` are git-ignored). One wheel per workspace,
  replaced whole (no merge); flavor rules stay the same under any wheel.

## Installable PWA, served over HTTPS (built)

Backlog item 28, branch `pwa-serve`. `docs/timer_architecture.md` §2,
README "Install it on your phone".

- The PWA was configured but never served: the frontend container ran the
  Vite dev server (no service worker or manifest, which only `vite build`
  makes) over plain HTTP on a LAN IP, where browsers allow neither. Phones
  got a browser shortcut.
- The frontend image now **builds the app and serves it with Caddy**
  (`frontend/Caddyfile`), which also proxies `/api` to the backend as the
  dev proxy did (`X-Forwarded-For`, so `TRUST_PROXY=1` still works). Hashed
  assets cache for a year; the shell, `sw.js` and the manifest are
  `no-cache`.
- **HTTPS from Caddy's internal CA**, for `localhost` and `APP_HOST`
  (`default_sni`, since a phone connecting by IP sends no server name).
  Each device trusts the root once, from `http://<address>/ca.crt`; port 80
  otherwise redirects to HTTPS. The CA lives in the `caddy_data` volume.
  `HTTPS_PORT` / `HTTP_PORT` if 443 / 80 are taken.
- The backend runs as production now (Secure session cookie); `APP_URL`
  and `CORS_ORIGIN` default to `https://localhost`.
- **Manifest:** named Barista-Assistant (short name Barista, also the page
  title), a description of what it does now, explicit `id`, `start_url`
  and `scope`, and `handle_links: preferred` with `launch_handler`
  `navigate-existing`, so reminder links open the installed app on
  Android.
- **Updates never land mid-brew:** `registerType: 'prompt'`, registered in
  `main.ts`; `createUpdateGate` (`lib/swUpdate.ts`) applies a waiting
  update at once, or after the brew is saved or abandoned while
  `brewSession.inProgress`. Plus an hourly update check, since an
  installed app can go days without a page load.
- **Ready for a server:** every service has `restart: unless-stopped`
  (nothing came back after a reboot before). Each data location can be set
  in `.env` (`DB_DATA_DIR`, `REDIS_DATA_DIR`, `CADDY_DATA_DIR`,
  `PHOTOS_DIR`, `BACKUPS_DIR`), defaulting to the named volumes and
  folders as before; MariaDB, Redis and Caddy take ownership of a new
  folder themselves, photos and backups must be owned by uid 1000. README
  "Run it on a server": configure, start, update, and move from another
  machine (stop, dump, copy, restore).
- `vitest` is now a frontend devDependency (it ran from the backend's
  hoisted copy, which the image's `npm ci -w frontend` doesn't install).
- Decided: one way to run it in Docker, the build; no dev-server container
  or override (live reload was already off in Docker, and `npm run dev` on
  the host still has it). Internal CA over a domain or Tailscale: no
  account, works offline on the LAN. Web Push was backlog item 30 (built: "Web Push from the installed app"); testing on phones is item 37.

## Caffeine estimate (built)

A brew's journal entry shows its estimated caffeine, and Insights → Overview
has three new tiles: Caffeine Total, Caffeine/Brew and Caffeine/Day.

- **Worked out, not stored** (`lib/caffeine.ts`, `docs/api/stats.md` §11, "How
  the client counts"), like extraction yield: no migration, and old brews have
  a figure straight away. Dose × the species' caffeine × the share extracted,
  with decaf taking off about 97%. Brew logs and stats beans now send what it
  needs (`decaf`, `species`).
- **Espresso is the brew without water**, not its method or style, so it still
  counts when the recipe was deleted or has no style.
- **The tiles follow the Insights filters**, as the others do, and Edit layout
  hides and orders them. Caffeine/Day counts quiet days.
- Decided: a brew counts its whole dose, since the log doesn't say how much of
  a batch was drunk. The AI doesn't see it, and there's no caffeine % per bean
  or Explore field for now.

## Published Docker images (built)

Images of each branch on Docker Hub, so a server can run the app without the
repo. README: "Run the published images".

- **Publishing:** `.github/workflows/docker-publish.yml` builds the frontend,
  backend and worker on every push to `main`, `testing` and `dev`, for
  `linux/amd64`. `main` is tagged `latest`, the others by name, and every
  build also `sha-<short>`. It runs on pushes only, so pull requests from
  forks can't reach the Docker Hub secrets.
- **`docker-compose.release.yml`** can be pasted into a Compose Manager stack.
  `IMAGE_TAG` picks the build. Unlike `docker-compose.yml` it has no `build:`,
  no host ports for dev tools and no test database, and it requires the
  `*_DIR` settings, since there's no folder next to it to fall back on.
- **Host ports** default to 42069 (HTTPS) and 42070 (HTTP redirect and
  `/ca.crt`) rather than 443 and 80, which most servers already use. Caddy
  still listens on 443 and 80 inside the container, and `HTTPS_PORT` and
  `HTTP_PORT` override them.
- **Data folders set themselves up:** the backend and worker start as root,
  take ownership of `/photos` and `/backups` (`DATA_DIRS`,
  `docker/entrypoint.sh`), then run as `node`, as the MariaDB and Redis images
  do. No `chown` on install, and it recovers from Unraid's New Permissions on
  the next restart. MariaDB also needs its `.my-healthcheck.cnf` mode put
  back, which the `db` service does at startup: it ignores a world-writable
  config file, so the healthcheck fails and the stack waits on it forever.
- **Behind a reverse proxy:** README section, from running it behind Nginx
  Proxy Manager with a mkcert certificate. The app keeps its own HTTPS, so the
  proxy forwards to `HTTPS_PORT` with scheme https.
- Decided: a second compose file over configurable image names, so the main
  file stays simple for building from source. `amd64` only for now.

## AI model and key in Settings (built)

Keys and models are set in the app, not only in `.env`, so a workspace can use
its own and the planned AI chat can pick a model that sees photos. API:
`docs/api/workspaces.md` §2d, `docs/api/server.md` §10b.

- **Who answers:** the workspace's own key, then the server's saved AI or its
  env, looked up when each job runs. An admin can stop offering the server's
  AI (with "I understand"), and workspaces with their own key carry on.
- **Providers:** OpenAI or compatible, and Anthropic natively. Jobs still build
  OpenAI-shaped requests, and `worker/src/ai/anthropic.ts` translates them, so
  the prompts, saved requests and snapshots didn't change.
- **Decided:** three models (main, vision, web). Base URLs are the server's
  alone: an owner setting one could make the worker reach inside the network,
  and a workspace's key always goes to the provider's own address.
- **Keys:** AES-256-GCM under `AI_CONFIG_SECRET`, in `workspace_ai_configs` and
  `server_settings`, never sent back, in job data or in backups, and scrubbed
  from provider errors. Test and the model list run on the saved key.
- **`AI_CONFIG_SECRET` is a plain variable, not a Compose secret:** Compose won't
  start if a secret's variable is missing, which would have stopped every
  existing install on its next update. An empty `OPENAI_API_KEY` is fine, since
  Compose then leaves the file out and the worker runs without it.
- **The backend never gets the env's key:** the worker writes whether it has one
  to `server_settings` (`ai_env`) when it starts.
- **Claude's web lookup is two calls:** it can't return a schema along with a web
  search's citations, so it searches, then a second call fills in the schema.
- Left out: usage or cost per workspace, a model per job type, and showing the
  model in the journal (it's recorded, not displayed).

## AI chat in Insights (built)

A **Chat** tab in Insights for asking the AI something of your own, with
brews, beans, recipes, charts and photos attached (`docs/api/chat.md` §12,
`docs/api/llm-contract.md` §9e). Five branches: `ai-chat`,
`ai-chat-attachments`, `ai-chat-photos`, `ai-chat-limits`, `ai-chat-export`,
then the attach picker, pasted photos, the layout and charts.

- **Streamed replies:** the worker holds the keys, so it calls the model and
  writes to a Redis stream (`chat-reply:<messageId>`); the backend passes it
  on as server-sent events, resumable with `Last-Event-ID`. One attempt: a
  retry would repeat text already read, so a failed reply has **Retry**.
- **Attachments** go through the analysis's summaries (`toLlmInput`,
  `beanInput`, `recipeInput`), read afresh every turn, so an edit or delete
  applies. In full: Settings → AI tunes the analysis and suggestions, not
  chat. Up to the workspace's `chatMaxAttachments` (default 50). The picker
  narrows brews by period, bean, recipe, brewer and only mine, with
  **Select all**; charts go as snapshots of their numbers.
- **Photos** picked, pasted or dropped, resized as bean photos are and kept
  with the chat; a chat with photos uses the vision model.
- **Keeping and purging:** limits on size and age for the server and each
  person (a person's can't exceed the server's), a daily message limit, and
  purging. Chat can be turned off for a workspace or one member.
- **Export and import** of a person's chats as a zip.
- **Decided:**
  - Chats are private to the person, owners included, and not in workspace
    backups (a backup would hand them to whoever downloads it): they have
    their own export.
  - Read-only at first: proposals came next (below, "AI chat proposals").
  - The AI sees only what's attached; it can't look things up itself.
  - Max size is what a person's chats take on disk, messages and photos
    together; the server's default is 1 GB, and going over removes their
    oldest chats first.
  - Purging chat data takes the "I understand" checkbox; deleting one chat
    doesn't, and has no confirmation.
  - Leaving or being removed from a workspace deletes your chats there; the
    dialogs say so.
- Still to do: a full test in the browser (backlog 18).

## Copy a chart (built)

Each chart card in Insights has a **Copy** button, so a chart can go into a
message or a note without a screenshot (`lib/chartImage.ts`, `ChartCard.vue`).

- **A picture of the chart:** the Chart.js canvas as a PNG, drawn onto a solid
  background in the theme's surface colour (the canvas itself is transparent),
  with the card's title drawn above it, since the canvas has none. It's drawn
  at the screen's pixel ratio, so it stays sharp.
- **While the card shows its table**, Copy copies the rows as tab-separated
  text, which pastes into a spreadsheet as columns.
- **Where an image can't go on the clipboard** (no `ClipboardItem`, a page
  that isn't a secure context, a phone that refuses it), the PNG downloads
  instead and the button says "Saved". The image is handed to the clipboard
  as a promise, straight from the click, which Safari requires.
- The button says "Copied" for two seconds, the same label swap as the
  menu's Copy link. There's no toast.

## Attach charts to AI chat (built)

The chat's attach picker has a **Charts** tab (`ChartPicker.vue`): every
chart on the Insights tabs the workspace shows, the Explore charts the person
added to a tab included, and **Overview totals** (the Overview's tiles as one
table).

- **The numbers, not a picture:** each chart goes as a snapshot of its
  title, note, table and what it covers ("Last 30 days · Only mine"), kept
  on the message (`docs/api/chat.md` §12). The figures are worked out in the
  browser, so the server can't rebuild them. Capped at 200 rows; past that,
  the AI is told how many were left out. No migration: it's in the
  `attachments` column, counts toward the chat's size and goes in the export.
- **Filters of its own:** the Insights filter bar sits on the Charts tab,
  starting as the page has it. Changing it there leaves the Insights page
  alone (`provideStats` with local filters). Charts with their own period
  follow the picker's.
- **How it gathers them:** the tab views are drawn out of sight with
  `CHART_HARVEST` provided; each `ChartCard` hands over its title, note and
  table instead of drawing (`lib/chartHarvest.ts`). The Overview's tiles moved
  into `useOverviewTiles` so both can use them.
- The same chart under the same filters is one attachment (its id is a hash
  of the two); under other filters, another.
- Insights' filter bar also got **Reset filters**, shown once a filter is off
  its default.
- Still to do: **Ask in chat** on a chart card (backlog 20).

## AI chat proposals (built)

Backlog item 19, branches `chat-proposals` (migration 0096),
`chat-proposal-cards` and `chat-proposal-form-fix`. A chat reply can carry up
to 3 proposals, shown as cards that open a form already filled in
(`docs/api/chat.md` §12 "Proposals", `docs/api/llm-contract.md` §9e).

- **Three kinds:** the next brew (bean, recipe, grind, temperature, ratio),
  a change to an attached recipe (only what changes), and a new recipe.
  **Open** fills in the brew page or the recipe form through a store, and
  nothing is saved until the person saves there; what's gone since is
  named. **Dismiss** folds a card, with **Undo**, saved on the chat.
- **A fenced block, not a tool call:** the reply ends with ```` ```proposal ````
  blocks of JSON, so any OpenAI-compatible server works. The worker holds
  them back from the stream, takes them out of the saved text, and checks
  each: refs (`a1`, `a2`, …) only to what's attached, values in range, a
  grind on the grinder's dial and a ratio in the method's range, as Suggest
  parameters does. One that fails is dropped.
- **Later turns** tell the AI what it proposed and what was dismissed.
- Proposals are on `ai_chat_messages.proposals`, count toward a chat's size
  and go in the export.
- Left for later: reviewing how good the suggestions are (backlog 19).

## Web Push from the installed app (built)

Backlog item 39, branch `web-push` (migration 0097). Reminders (rate later,
steep, rest, low green stock) can arrive as the app's own notifications, as
one more channel beside ntfy and the others (`docs/api/notifications.md`
§1b "Web Push").

- **One entry per device:** a new `push_subscriptions` table, since
  `notification_channels` is one row per kind. Each device has its own on/off,
  Send test and Remove; every enabled one is notified. A device is turned on
  from itself (Settings → Notifications → This app), and named from its user
  agent ("Android · Chrome"). The same endpoint subscribing again updates
  that device, also when someone else signs in on it.
- **Server keys from `.env`:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (or
  `_FILE`) and `VAPID_SUBJECT`, all three or none; half set refuses to start.
  Without them Web Push is off and saved devices are kept but not sent to
  (and don't count as a channel for Rate later).
- **Sending:** `web-push` in `@barista/shared/webPush`, used by Send test and
  the worker's `deliver()`, which now sends to channels and devices alike. A
  push service answering 404/410 means the subscription is gone: the device
  is removed.
- **Where it can't subscribe**, the section still lists the devices and says
  why: on iPhone and iPad, add to Home Screen first; plain HTTP; or a browser
  without push. A service worker that never starts (an untrusted certificate)
  is reported when subscribing.
- **Service worker:** still generated by `vite-plugin-pwa`;
  `workbox.importScripts` loads `public/push-sw.js`, which shows the
  notification and, on a tap, has an open window go to the link through the
  router (so a brew in progress asks before leaving), else opens one.
- Not in a workspace backup (`NOT_BACKED_UP`), like the other channels.

## Coffee used and stock left as a chart card (built)

Backlog item 22, branch `beans-usage-card`. The plain table at the end of
Insights → Beans is now a chart card (`beans.usage`), so it can be pinned to
the Overview and attached in chat like the others; the Beans list shows the
stock at the top.

- **Chart:** a horizontal bar per bean, used and left side by side, the 10
  most used and the rest as "Other" (as Varieties does). The table view lists
  every bean in grams; an archived bean says "(archived)" and has "–" left.
  The table's links to the bean editor went with it.
- **Sorting:** not added; most used first, as before. ChartCard tables still
  don't sort.
- **Beans list:** a compact line above the Active tab's list: the stock in
  hand, split into unfrozen and frozen (beans with an open freeze period),
  worked out in the client from `inventoryWeightGrams` and `frozen`.
- The old table also showed on the Overview whenever any Beans chart was
  pinned there; as a chart card it only shows when pinned.

## Resizable table columns (built)

Backlog item 41, branch `resizable-columns`. The list tables (Beans,
Recipes, Grinders, Brewers, Drinks, Ingredients, Water profiles) have
resizable columns on a wide screen.

- **Resizing:** drag the line at a header's right edge; double-click it to
  fit the column's widest cell; with the line focused, the arrow keys step
  16 px (64 with Shift). The last column keeps its width (it's the table's
  edge). Widths run from 40 to 800 px.
- **How:** one shared piece, `ColumnResizers.vue` with `useColumnWidths`
  (`lib/columnWidths.ts`). The handles sit over the header row on the
  table's own `--cols` grid, so the sort buttons are unchanged. A resized
  column becomes `minmax(40px, <width>px)` and the flexible ones keep a
  40 px floor, so on a narrower window the resized ones give way first and
  no column disappears.
- **Remembered** per list and workspace on the device, like the sort
  (`<list>.columns.<workspace>`; Beans shares one set across its tabs). A
  saved set that no longer matches the table's columns is ignored.
- **Reset columns:** a link above the table, shown once any column on it
  has been resized.
- **Phones:** unchanged; the header row and the handles are hidden there.
- Hiding and reordering columns were left out: backlog 40.

## Settings nav scrolls on its own (built)

Backlog item 40, branch `settings-nav-scroll`. On a wide screen the Settings
categories beside the page (`SettingsLayout.vue`) stay within the window:
when the list is taller (a short laptop screen, or an admin with the Server
tabs too) it scrolls on its own, separately from the page, so its last
entries can always be reached.

- **How:** the sticky nav gets a max height of the window less its top and
  bottom gap, `overflow-y: auto` and `overscroll-behavior: contain`. A little
  padding, taken back by a negative margin, keeps focus rings from being
  clipped.
- **Selected tab in view:** each tab mounts its own layout, so the nav starts
  at the top again on every switch. When the selected tab is out of view it's
  scrolled to the middle of the nav (setting the nav's own scroll, so the
  page doesn't move).
- **Phones:** unchanged; the nav is its own page there.

## Hide and reorder table columns (built)

Backlog item 40, branch `column-options`. Every list table (Beans, Recipes,
Grinders, Brewers, Drinks, Ingredients, Water profiles) has a **Columns…**
link in the row with "Select to export… / Import…" (for every member, not
just owners), opening a dialog in the style of Sonarr's table options.

- **The dialog** (`ColumnsDialog.vue`): a checkbox per column, and its place
  by dragging the handle, the ↑/↓ keys on it, or the ▲▼ buttons. The table
  changes as you go. The name column is listed, greyed out, as always shown
  and first. "Back to the default columns" undoes it all.
- **Per device, wide and phone apart** (`lib/tableColumns.ts`): remembered
  per list and workspace on the device (`<list>.columnChoice.<workspace>`),
  with a separate choice for phone width (≤ 560 px). On a phone the dialog
  picks what's on the line under each name; the end column (Added, or the
  rating on Beans) stays beside the name there. Phones start from what they
  showed before: Beans keeps roaster, roast and stock; its ❄ column is
  wide-only, since the mark sits by the name on a phone.
- **Field settings win:** a column whose field the workspace hides under
  Settings → Fields drops out of the table and the dialog (Recipes: style;
  Beans: roast level, process, roast date and the age with it, decaf).
- **Alignment:** the end column stays right-aligned wherever it's moved;
  the others stay left-aligned, even when last.
- **Widths by column:** saved by column id now, so a column keeps its width
  when moved or hidden and shown again; widths saved by position before
  carry over. "Reset columns" became **Reset widths**, in the same row.
- **Shared pieces:** `TableHead.vue` (sort buttons, plain headers for
  unsortable columns, the resize handles) and each view's `TABLE` list with
  a cell function, instead of hand-written header and cells.

## Brew problems offered by methods and brewers (built)

Backlog item 8, branch `problems-offered`. A brew problem was for one
method or every method; now it's offered like a prep item (2026-10-27):
for every brew, or chosen methods and brewers ("Paper taste" for filter and
the Oxo Rapid Brewer, not a moka pot).

- **Model:** `brew_problems.method_kinds` (JSON list) plus a
  `brew_problem_brewers` join table; both empty = every brew. Migration
  0098 turns each `method_kind` into a one-item list (`null` → `[]`), 0099
  drops it. The defaults keep their one method, or every brew.
- **API** (`brew-problems.md` §6b): `methodKinds` and `brewerIds` on the
  problem, POST and PATCH, brewers checked to be the workspace's; a brew
  log's problem refs are `{ id, name }`.
- **Moved to Bar setup → Problems**, next to Prep (the open question):
  a list page like Prep (reorder, Show archived, select to export, import,
  a badge saying where each is offered) and an edit page per problem
  (name, Offered for, Archive/Restore, Delete). Settings → Lists lost the
  card and points there. The "Offered for" card is one component,
  `OfferedFor.vue`, on both edit pages.
- **Brew page and journal** offer problems with `offeredFor`, as prep.
- **Backups:** version 5 upgrades version 4's `methodKind`; the join table
  restores after brewers, and a problem export brings its brewers along.

## Repeat brews: bean and recipe as choices (built)

Backlog item 7, branch `repeat-bean-recipe`. A repeat always copied the
bean and what → brewer → recipe, so repeating with the bag you just opened,
or the same bean on another recipe, meant changing them by hand
(2026-11-06). Set aside on 2026-10-27 over whether a repeat without them is
still a repeat; built since the defaults keep it one.

- **Two new options**, `bean` and `recipe`, first in Settings → Brew setup
  → Copy when repeating and on by default, so nothing changes unless you
  switch them off (`docs/api/auth.md` §1 repeatKeeps).
- **Bean off:** setup keeps the bean it had (remembered, or empty to pick).
  On, the "newest bag of the same coffee" fallback stays.
- **Recipe off:** what you're making and the brewer still come from the
  brew (the open question); the brewer picks its last recipe, as for a new
  brew. Only what → brewer and the prep checklist are always copied now.
- **Notes on what couldn't be filled** carry the options they're about
  (`RepeatNote`, `repeatMissing` in `lib/repeatBrew.ts`), so an archived
  bean or recipe isn't mentioned when it wouldn't have been copied. This
  replaces matching on the note's wording in `BrewView`.
- **Migration 0100** adds `bean` and `recipe` to every saved `repeatKeeps`
  list, so people who had saved their choices keep copying both.

## Change the brew window for any brew (built)

Backlog item 6, branch `brew-window-any-brew`. Only rapid cold could change
its target finish on setup; every other brew timed against the recipe's, so
trying a longer drawdown or a shorter shot meant editing the recipe first
(2026-11-06).

- **Every timed brew** (all but the long cold styles, which keep "Steep
  for" in hours) shows the **Target finish** pair on setup; espresso's says
  **Target shot time**. It starts from the recipe's window for the batch
  (shifted with `stepTimeScaling`) and follows the batch until it's typed
  in; "Use it" goes back. The timer uses it.
- **Always saved** with the brew (`expectedFinishMinSec` / `MaxSec`, no new
  columns), changed or not, so the journal shows "(target …)" and Insights'
  early/late judge the window the brew was really timed against, scaled.
  Older brews without one still fall back to the recipe's.
- **Setup only:** not during the timer, and `PATCH` still refuses it
  (`docs/api/brew-logs.md` §6).
- **Espresso's first-drop window** per brew was left out: it would need its
  own brew columns.
- **AI:** the core prompt says to judge the time against the brew's own
  window, which may differ from the recipe's (`docs/api/llm-contract.md`
  §9). No new context field.
- **Settings:** the `brew.window` field and the Repeat brews `window`
  option are now "Steep or finish time", for any style.

## Prep steps (built)

Backlog item "Prep steps that don't start the timer", branch
`prep-steps-2` (the parked `prep-steps` work, brought up to date), no
migration. Rinsing the filter or preheating, written as steps, started the
timer and pushed every later step. A `tap` step doesn't help: it still runs
on the brew clock, so its time counts in the brew time, the target window
and what the AI sees. Contract: `api/recipes.md` §5 (prep steps),
`timer_architecture.md`.

- **Prep steps:** a `prep` step type for every method, with what to do and
  an optional countdown, always before the other steps (**Add prep step**
  puts it there). They're off the clock: planned times, the timer, the
  finish window and step time scaling leave them out (`scalesWithBatch` is
  always false).
- **Timer page:** before Start, they run in the same Previous / Current /
  Up next cards as the brew steps ("Prep 1 of 2"), each with **Done**; a
  timed one has **Start 2:00**, a countdown that beeps and vibrates at 0 and
  moves on. Then "Ready", with the first brew step up next. Start skips any
  left; the clock stays 0:00 and nothing is saved. A long steep lists them
  first in its checklist. (A checklist card on brew setup was tried first
  and moved here.)
- **Marks:** the timer counts its steps from 1, so step marks (`step_end`,
  `step_hold`, `step_resume`) are shifted past the prep steps and keep the
  recipe's `stepOrder`.
- **Decided:** prep items (the Prep checklist) stay what was done, tracked
  for the AI; prep steps are the recipe's instructions, with a countdown
  when timed. Prep steps go to the AI with the other steps (same switch),
  typed `prep`; AI chat can propose them in a recipe.

## Public menu: branding and sizes (built)

Backlog item 20, branch `menu-branding-sizes`, migration 0102. The guest
page had one look for every bar, and a drink one price whatever its size
(2026-11-06). Contract: `api/menu.md` §7b, `api/public-menu.md` §7.

- **Branding**, in Settings → Workspace beside the title: a **tagline**
  under the title, an **accent colour** (`#rrggbb`) for the title, section
  headings and rules, and a **logo** above the title. The colour is
  lightened in dark mode (mixed with white) and Settings warns when it's
  too light for headings on white (under 3:1). Empty = the app's brown.
- **Logo:** stored like bean photos (`backend/src/photos.ts`: upright,
  inside 1024 px, WebP, transparency kept) at
  `PHOTO_DIR/<workspaceId>/<menuLogoId>.webp`; a new upload gets a new id
  and removes the old file. Served unauthenticated at
  `/api/public/menu/:slug/logo/:id`, also while the menu is off, so the
  preview and Settings can show it: the id is random, so only someone who
  has seen the menu knows it. The photo sweep keeps it; a `.zip` backup
  carries it (a JSON one doesn't), restored under a new id.
- **Several logos** (2026-11-06, migrations 0103/0104: `menu_logo_id`
  became the list `menu_logo_ids`): up to 6, kept like a bean's photos in
  Settings (`MenuLogos.vue`): drag ⠿ to reorder, crop or rotate
  (`PhotoCropDialog.vue` with `transparent`, so a logo's background stays
  see-through: PNG, up to 2048 px), remove. Only the first shows on the
  menu; the user chose that over a photo strip or a rotating header, so the
  others are alternatives to swap in. Each is served at the public logo URL
  (ids unguessable, as before).
- **Sizes:** a free list per item (the user's choice over a menu-wide size
  list or sizes on the drink): up to 6 `{ label, price }`, in order,
  instead of the single price, never both. Guests see "8 oz 4.00 · 12 oz
  4.75 USD". Drinks still have one serving size for brewing; menu sizes
  don't touch it.
- **Not built:** installing the guest menu as its own app stays an open
  question (it was the item's; not now, per the user).


## Recipes sort by brewer and dose (built)

Backlog item 10, branch `recipe-sort-brewer-dose` (2026-11-07). The Recipes
table showed Brewer and Dose columns, but only Name, Style and Added sorted.

- **Brewer** sorts by the brewer's name (A–Z / Z–A), **Dose** by the coffee
  dose in grams (lowest / highest first), the first figure in the Dose
  cell. Both are in the column headers and the Sort by dropdown; ties fall
  back to the name, as everywhere else (`sortBy` in `lib/listSort.ts`).
- **Not done:** checking the other list pages for columns that show but
  don't sort; ask if one turns up.


## Every table column sorts (built)

Branch `sortable-columns` (2026-11-07), following "Recipes sort by brewer
and dose". Drinks was the one list left with columns that showed but didn't
sort (Category, Method); the rest already sorted by every column.

- **Drinks:** Category sorts in the categories' order (the one under the
  list, drink-categories.md §5d), uncategorised last either way; Method in
  the built-in order (filter, espresso, stovetop, other). Both are in the
  headers and the Sort by dropdown and give a flat list, like date added;
  only Name nests variants under their parent.
- **From now on:** `useTableColumns` (`lib/tableColumns.ts`) takes the
  list's sort columns and doesn't compile when a table column has none, so
  a new column comes with its sort or the build fails. The view declares its
  `TABLE` as `TableColumn<keyof typeof columns>[]` and its sort columns with
  `satisfies SortColumns<Item>` (a `: TableColumn[]` table, whose ids can't be
  checked, fails too). The sort columns can have more than the table (Beans:
  date purchased, variety). `TableHead` makes every header a sort button;
  `tableColumns.test.ts` holds the type checks.


## Notes page (built)

Backlog item 25, branch `notes-page` (2026-11-07). Things that get looked up
again and again (cleaning powder per litre, descaling the kettle, a
burr-cleaning routine) lived in a phone note outside the app.

- **What:** Bar setup → **Notes**, after Problems. Titled notes with text
  formatted like chat replies (`ChatMarkdown.vue`, `lib/markdown.ts`: drawn as
  elements, never HTML), shared with the workspace. Search matches every word
  in the title or text; pinned notes come first, then the most recently
  changed. A note opens in the list; adding, editing and deleting are on its
  own page. API `docs/api/notes.md` §3h; table `notes` (migration 0105), the
  body MEDIUMTEXT for up to 20 000 characters.
- **Scaling amounts:** a line like "20 g per 1 L", "2 tablets per litre" or
  "1 tbsp / 500 ml" gets a **Scale for** box under the note (ml, cl, dl, L,
  fl oz; a decimal comma is fine). It's the page's own
  (`lib/noteScaling.ts`, `NoteScale.vue`); only the last volume is
  remembered, per note on the device. The default unit follows the volume
  preference (L, or fl oz).
- **Decided:** pinning is the workspace's (`pinnedAt` on the note), not a
  person's. Deleting a note has no "I understand" (nothing uses it, rule 7).
  Notes are in backups (no version bump: an older file without the table
  counts as empty) and export or import by list, matched by title, a copy's
  title numbered.
- **Not built:** the AI never sees notes. Reminders and recurring tasks
  ("descale every month", maybe on the brew page) and notes on a piece of
  equipment became backlog item 25, "Upkeep tasks and reminders".


## Notes: calculators instead of automatic scaling (built)

Branch `notes-calculators` (2026-11-07), right after "Notes page". Scaling
found automatically in the text ("20 g per 1 L") wasn't intentional enough:
you should be able to write plain notes, and add something to work out on
purpose. Inspired by Bar Assistant's calculators (inputs and formulas),
kept general.

- **Notes are blocks:** text and calculators, in any order, as many as
  needed (up to 50). `notes.body` became `notes.blocks` (JSON): migration
  0106 turned each body into one text block, 0107 dropped the column.
  Notes with a body never left `dev`, so backups have no upgrade for them.
- **Calculators:** inputs (label, key, unit, default) and results (label,
  key, formula, unit, decimals), worked out in order, so a result can use
  the ones above it. Formulas: numbers, keys, `+ − * / % ^`, parentheses,
  `round floor ceil abs sqrt min max`, parsed and worked out by
  `lib/calc.ts` (never `eval`). Keys come from labels until changed by hand.
  Templates: blank, amount per volume, ratio, dilution (percent). A new
  calculator starts from Blank, one input (`DEFAULT_TEMPLATE`, branch
  `calculator-default-blank`); whether the others keep two is backlog 26.
- **Using one:** anyone who can read the note types into its inputs; the
  values are remembered on the device (per note and block) with a Reset,
  never saved to the note.
- **Checks:** the editor won't save until every formula works out (unknown
  or later keys, syntax, labels, keys). The API checks shapes, keys
  (unique per calculator, ignoring case) and limits, not formulas; the page
  shows an error for one it can't work out. A note's request may be up to
  1 MB (the default is 100 kB).
- **Removed:** the automatic "20 g per 1 L" detection (`lib/noteScaling.ts`,
  `NoteScale.vue`).
- **Not built:** unit conversion between inputs (an input's unit is a
  label), and the AI still never sees notes.


## Finish offset for hands-busy brewers (built)

Branch `finish-offset`; was backlog 8 for a moment (added and built the same
day, so the backlog's numbers are as before).

- **Why:** on some brewers the brew ends while your hands are busy. Pressing
  an OXO until the hiss, then reaching for the phone, put a few seconds on
  every brew time, so the target window said "late" and the AI saw a slower
  brew.
- **Where it's set:** `finishOffsetSec` (whole seconds −60 to 60; negative adds time, for
  tapping early) on a brewer
  (Bar setup → Brewers), and on a recipe to override it: blank = the
  brewer's, 0 = none for this recipe. Migration 0108. Not on long cold
  styles (no timer). The recipe field is hideable (`recipe.finishOffset`).
- **On the timer:** the button reads "Finish & Save · −4 s" (or "· +3 s"). The timer still
  emits the time as tapped, and the brew page takes the offset off
  (`lib/finishOffset.ts`), never going back past the last mark or below 0.
- **On the log form:** under Total time, "−4 s offset" ("+3 s" for a
  negative one) with Undo beside it until the time is changed by hand. The tapped time is kept in
  memory until the brew is saved or left, never stored.
- **Not sent to the AI:** the offset itself isn't in the analysis context;
  the adjusted time is what the AI already sees.
- **Not built:** other ways to mark the end (start the countdown before the
  hiss, a tap-anywhere "done" area). Revisit if a fixed offset isn't enough.


## Step temps reach the AI (built)

Branch `step-temps-ai`; was backlog 12. The "brews keep a copy of their
recipe" question it raised is backlog 12 now.

- **Why:** with `stepTempsFollowBrew` a brew moves the recipe's step temps
  (`stepTempShiftC`), but the worker read them from the recipe as written.
  A bloom brewed at 87 °C reached the AI as 85 next to the brew's 96 °C water.
  The prompt never said how the temps relate.
- **Analysis:** `scaledToBrew` (`worker/src/context.ts`) now applies the
  brew's shift with `shiftStepTemps` (`@barista/shared/brew`), on top of
  the step time scaling. The brew sends `stepTempShiftC`, and the recipe
  sends `stepTempsFollowBrew` when it's on.
- **Suggest:** the recipe's step temps go as written, because the next brew
  hasn't picked a temp yet. Each earlier brew says how far it moved them.
- **Prompt:** a new `stepTemps` section (editable like the others) is
  included when a step's temp differs from the recipe's, or when the steps
  follow the brew. It says what the recipe's, the brew's and each step's
  temp mean. It also says `suggestedTempDelta` / `tempC` are for the water
  temp, and step temps follow them only with `stepTempsFollowBrew`.
- **Hiding it:** both new fields go with the existing `temp` switch
  (Settings → AI); `stepTempsFollowBrew` also goes with `recipeSteps`.


## Brews keep a copy of their recipe (built)

Branch `brew-recipe-copy`; was backlog 12 (raised by the step temps review,
just above). The backlog's later items moved up one.

- **Why:** a brew pointed at the live recipe, so editing a recipe changed
  what every old brew was judged against: its targets, steps and step temps.
  Reordering steps also made old `step_end` / `step_hold` marks point at the
  wrong step. Deleting a recipe left its brews with none.
- **What's kept:** `brew_logs.recipe_copy` (JSON, migration 0109): what the
  timer and the AI judge a brew against (`RecipeCopy`,
  `@barista/shared/recipeCopy`), as the recipe wrote it. The backend takes
  it on create, and on `PATCH` when `recipeId` changes to another recipe
  (`backend/src/recipeCopy.ts`). It's never returned by the API.
- **Who uses it:** only the AI (`recipeAsBrewed` in `worker/src/context.ts`):
  analyses and chat brew attachments. The brew's own scaling (water,
  `stepTempShiftC`) is still applied when it's read. Grind starting points
  stay live. A deleted recipe's brews keep their copy and its name and style.
- **Decided against:** showing the copy on brew screens (they and Repeat
  brew use the current recipe, which is what you want after improving it),
  copying the whole recipe (notes, grind starting points, finish offset),
  and backfilling old brews (they'd get the current recipe, which may not be
  how they were brewed). Brews from before have no copy and use the live
  recipe as before.
- **Backups:** the copy goes in every file and is checked against
  `RecipeCopy`. An older file restores without copies.


## Usual grind adjustment per grinder (built)

Branch `grinder-usual-adjustment`; was backlog 5. Per-method or learned
values are backlog 5 now.

- **Why:** the step size is the smallest move on the dial, so the AI talked
  in single clicks, while people dial in by a habitual amount (2 clicks on a
  Comandante, half a number on an Encore), and one click is often too small
  to taste.
- **Field:** `grinders.usual_adjustment` (migration 0110), optional, in dial
  units like the setting (so it works without a step size, stepped or
  stepless). On the grinder form under the setting range, and in the
  grinder summary ("0–40, 1 per step, usually 2").
- **AI:** sent with the grinder in `equipment` for the analysis and Suggest
  parameters. A new `usualAdjustment` prompt section (editable) appears when
  a grinder has one: size a grind change by it, more for a big miss, less
  (down to one step) when the cup is nearly there. It's a hint, not a rule:
  the grind delta stays the `finer`/`much_finer` enum, so it shapes the
  wording and Suggest's `grindSetting`. Prompt version `2026-11-a`.
- **Hiding it:** under the existing Grinder details switch (Settings → AI),
  with the range and step size; no new switch.
- **Decided against (for now):** a number per method, and learning it from
  history (backlog 5).


## Target finish window under the steps (built)

Branch `finish-window-follows`; was backlog 8.

- **Why:** the window and the steps are typed separately. A recipe could
  say 3:00–3:30 while its steps ended at 4:10, so the timer marked every
  brew slow and the AI saw a target the recipe couldn't reach. The form
  warned, but the window was in the card above, away from the steps.
- **The box moved:** the Target finish / Target shot time box is now at the
  end of the steps card, under the line comparing them ("Steps end at 3:15
  · Target finish 3:00–3:30", warning-coloured when outside). The first
  drop window and the finish offset stay in the first card.
- **Espresso warns like filter:** the "window ends before the steps do"
  warning at the bottom of the form now covers espresso too (only the
  pour-to-water check is filter-only).
- **Espresso's default spread:** a shot's window is closer, so typing one
  end alone gives the other ±3 s (filter stays ±15 s), in the API
  (`docs/api/recipes.md` §5, by the recipe's brewer after the request) and
  the recipe and brew forms.
- **Decided against:** the window following the steps' end (built and
  tried; it felt worse than setting it yourself), a second window box by
  the steps, and confirming on save. The server still doesn't enforce it.

## Yield estimates per brewer (built)

Branch `brewer-retention`; was backlog 8.

- **Why:** the yield estimate (water − retention × dose) never looked at
  the brewer. The OXO brews of Soup and Zuppa Lunga measured 0.99–1.35 g
  of water kept per g of coffee against the 2.0–2.05 default, so their
  estimates came out far too **low** (Soup 80 ml: 36 g estimated, ~68 g
  measured). Pressing squeezes out water a drip cone leaves in the grounds;
  an AeroPress behaves the same. V60 brews measured ~2.4.
- **Bugs fixed:** retention under 1 g/g was thrown out as implausible, so a
  pressed brew (0.99) and Soup 100 ml's recipe yield (0.9) were ignored and
  the estimate fell back to the roast default. The floor is now 0.5.
- **Brewer retention:** `brewers.grounds_retention` (migration 0111), g per
  g, optional, on the brewer form for non-espresso brewers. Blank = learned:
  the median of the brewer's latest 20 measured brews, any bean or recipe.
  The form shows the learned figure with a **Use** button.
- **Order:** your brews of this bean with this recipe → the recipe's
  expected yield (roast-adjusted) → the brewer's typed figure → its learned
  figure → the roast default. The brewer's figure isn't roast-adjusted: the
  method matters more than the roast.
- **The recipe's yield stays in charge, with a suggestion:** when the brew
  page estimates from the recipe's yield but the brewer's figure points
  more than 10% (and at least 5 g) away, it says so and links to the
  recipe. The recipe form estimates with the brewer's figure, and a typed
  yield it clearly disagrees with gets a note next to "Use estimate". The
  brewer's brews load before a saved recipe is filled in, so a yield saved
  from the old roast estimate counts as typed and is kept, not overwritten.
- **Not sent to the AI;** it's an aid for estimating, not brew data.
- **Left for later:** Insights volume figures still estimate unmeasured
  brews with the roast default (backlog 13).

## Checks and step guidance for AI recipe proposals (built)

Branch `recipe-proposal-checks`; the first round of backlog 15.

- **Why:** a chat proposal for a V60 once gave two blooms, 11-second pours
  and 22-second drawdowns. Nothing checked a proposal's steps beyond the
  value ranges, so a bad plan only showed once opened in the recipe form.
- **Step checks** (`@barista/shared/recipeChecks`, `recipeStepWarnings`):
  water targets going back down, the last pour more than 2 g off the
  recipe's water, a pour faster than 12 g/s or slower than 1 g/s, and the
  steps ending after the finish window or more than 60 s before it.
  Espresso: the window only. Loose on purpose: the recipes brewed most
  (Ramped Bloom with its deliberate double bloom, Soup, Zuppa Lunga,
  Espresso Pre-Infusion) pass. Soup (100 ml) as saved doesn't: its pour
  goes to 80 g of its 100 g water, which the recipe form also warns about.
- **Flagged, not dropped:** a failing `recipeChange` or `newRecipe` keeps
  `warnings`, listed on its card under "Check the steps before saving". A
  change is checked as the recipe after it, and only when it touches the
  steps, the water or the window.
- **Decided against:** checks on blooms (more than one, or short) and on
  the final drawdown, since double blooms are deliberate here.
- **Prompt** (`CHAT_PROMPT_VERSION` 2026-11-b, new): step timing at a
  kettle's pace, realistic waits and drawdown, water rising to the recipe's,
  steps ending inside the window, fewer steps over invented precision, a
  multi-hour steep in the text rather than as a step, the block added when a
  recipe is asked for, and a variation that differs.
- **Eval** (`propose`, `compare-propose`): 8 recipes, before and after, on
  gpt-6-luna. Neither run tripped a check (the V60 case didn't come back);
  after the change V60 pours slowed from 8-9 g/s to 4-6 g/s, every V60 got a
  final drawdown step, the cold brew stopped putting its 14-hour steep in a
  50,400 s step, and no variation was a copy. An earlier run had 4 of 8
  replies describing a recipe without a card.

## Weekly and monthly recaps (built)

Branches `recaps-insights`, `recaps-banner`, `recaps-notify`, `recaps-ai`
(and `workspace-timezone`); backlog 18, kept there to review after testing.
Spec: `docs/api/recaps.md` §11c.

- **Insights → Recap:** a week or month at a glance against the period
  before (brews, days, average and best ratings, caffeine, volume, coffee
  used, beans brewed, bought and finished, new recipes, the most used recipe
  and brewer), worked out in the browser from `/stats`. Steps through
  periods; yours or everyone's. Weeks start on the person's chosen day, and
  Insights' weekly charts follow it.
- **Settings → Recaps** (per person): on or off, weekly / monthly / both,
  week start, banner and its days (default 3), notification and its time
  (default 8:00, quarter hours), the AI summary (off / when I ask /
  automatically, default when I ask). Off, a recap still shows on request.
- **Brew-page banner:** "Your weekly / monthly / weekly and monthly recap(s)
  ready", only for periods with your brews; gone when opened, dismissed or
  after its days (`recapSeen` on the account).
- **Notification:** a quarter-hourly `recap-tick` on the reminder queue;
  on the first day of a new period at the person's time in their zone (else
  the workspace's, else `BREW_TIMEZONE`), one per workspace brewed in,
  claimed on a `recaps` row (not backed up) so it goes once; retried that
  day only.
- **AI summary** (llm-contract.md §9f, `RECAP_PROMPT_VERSION` 2026-11-a):
  `{ summary, highlights }` from `loadPeriodContext` / `toPeriodInput`
  (hidden details left out, newest 60 brews), the person's own instructions
  added. On request (`POST /recaps`, polled) or automatically before the
  notification, never twice for one row. Eval `recap`: three of the user's
  weeks on gpt-6-luna, about 2.4–3.5k tokens in, summaries grounded in the
  brews' notes (grind changes, brewer shift, week-on-week averages).
- **Workspace time zone** (Settings → Defaults): overrides `BREW_TIMEZONE`
  for brews logged without an offset, the suggestion's "today", and recap
  notifications for members without their own.

## Live periods in chat (built)

Branch `chat-period`; was backlog 17. Spec: `docs/api/chat.md` §12,
"Periods"; `llm-contract.md` §9e.

- **What it is:** the chat picker's Brews filters (period, bean, recipe,
  brewer, only mine) saved as one attachment, `{ kind: "period", period }`,
  and run again for every reply, so a long chat about a stretch of brewing
  sees brews logged, changed or deleted after attaching. One chip ("Brews,
  last 30 days · Guji · Only mine"); counts as one toward
  `chatMaxAttachments`. Select all is still there for a fixed list.
- **Periods:** rolling (last 7 / 30 / 90 days, last year) move with the
  chat, counted from each reply's day in the workspace's zone; This / Last
  week (on the person's week start), This / Last month and custom dates are
  fixed when attached; All time has no dates.
- **What the AI gets:** `loadPeriodContext` (built for recaps), now with
  bean, recipe and brewer filters, an open start and its own cap: figures
  over every brew, the same filters over the period before (the calendar
  week or month before, else as many days; none for All time), the newest
  brews in detail and `brewsLeftOut`, plus `filters` by name. In full, as
  chat attachments are. Chat prompt 2026-11-c says what a period holds.
- **Cap:** `chatPeriodMaxBrews` (Settings → AI, owners, 10–300, default 60);
  a person's own lower `periodMaxBrews` under Settings → AI chats. The
  lower applies.
- **Token warning:** past about 20k tokens a reply, the picker and the
  composer say "≈ 40k tokens, sent again with every reply" (per-kind
  averages measured on the real journal: a brew about 610 tokens, a period
  brew 190).
- **Long chats** (raised in review: a period attached early fell out of
  the 40-message window without a word): a reply is now sent what the whole
  chat attached, and past 30 messages or about 60k tokens the Chat tab
  offers **Summarize and continue**, Claude Code's compact for chats: the
  AI folds all but the newest 10 messages into a summary sent ahead of the
  rest (migration 0114, `chat.md` §12 "Long chats"). The summary can be
  edited or cleared from its divider, since a wrong one would otherwise
  carry forward; one stuck for 10 minutes is marked failed (0115).
- Left out: a period gives proposals no ref (it isn't one item); other
  kinds (the beans opened in a period) weren't asked for.

## Pinned chats, one-chat export, chat limit warning (built)

Branch `chat-pins`. Spec: `docs/api/chat.md` §12 ("Pinned chats",
"Exporting a chat", "The warning").

- **Pins:** `PUT /chats/:chatId/pin` (migration 0116, `pinned_at`). Pinned
  chats sit in a Pinned group at the top of the chat list, a 📌 on each row
  to toggle. A pinned chat is kept from the person's own age limit (not
  the server's) and is deleted for size only after every unpinned one.
- **Export one chat:** Export ▾ in the chat's header: Markdown built in the
  browser, PDF through the browser's print dialog (no PDF library, so
  nothing new to license under the AGPL), and the importable zip from
  `GET /chats/:chatId/export`, which keeps the pin.
- **Warning:** small yellow text under the composer at 80% of the size
  limit, and a week before an age limit would delete the open chat, with
  a link to Settings → AI chats.
- **The server's age limit still applies** (raised in review: pinning
  skipped every age limit, so anyone could keep a chat past an admin's):
  a pin keeps a chat only from the person's own age limit, and the admin
  page says so.
- **Pin limit:** `maxPinned` (server, per person across workspaces,
  default 20). Pinning past it opens a dialog: unpin the longest pinned
  chat or one you pick (a swap, `unpin` on the pin route), with Export on
  each. Lowering it unpins nothing. An import over it brings the extra
  chats in unpinned.
- **Saving limits asks first** (raised in review: an admin's Save deleted
  everyone's chats past a new age limit on the spot, pinned ones too, before
  any warning): both settings pages preview what a save deletes and
  confirm with the count (the admin's with "I understand"), and pinned
  chats a new server age limit catches get a week (`maxDaysSetAt`).

## Journal filters (built)

Branch `journal-filters`. The Journal only filtered by bean, so there was no
way to find, say, every cold brew. Contract: `api/brew-logs.md` §6 (GET list).

- **Filters:** style, brewer, recipe, bean, period (Insights' ranges, with
  custom from–to), status (Steeping, Not rated, Not analyzed) and Only my
  brews, in a folded Filters bar (`FilterBar.vue`, as the chat attach
  picker) whose line says what's applied, with Clear filters.
- **Only mine** sits beside the bar, not in it, and starts on (`mine=0` in
  the URL when off); Clear filters leaves it. Made a rule (CLAUDE.md 13).
- **API:** the list takes `styleId` (the recipe's style) and `status`;
  not rated and not analyzed count finished brews only.
- **In the URL** (`lib/journalFilters.ts`), defaults left out, so Back and
  reloads keep them and old `?bean=` links still work.

## Brews keep their style (built)

Branch `brew-style`, migration 0118. Whether a brew was a cold brew came from
the recipe it links to now, so restyling or deleting a recipe moved old brews
out of Cold brew, and would lock a batch's servings. Contract: `api/brew-logs.md` §6.

- **`brew_logs.style_id`**, like `brewerId`: set from the recipe, follows a
  change of the brew's recipe, kept otherwise. Backfilled from each brew's
  recipe (none of the existing brews had a recipe copy to go on).
- **Uses it:** the Journal's Style filter, the batch check (`isBatchStyle`:
  the brew's style, else its recipe copy's, else having servings), Insights
  rows, and the journal entry's batch rows.
- **Backups:** an older file's brews take their recipe's style on restore.

## Cold brew servings on the journal entry (built)

Branch `servings-ui`, migration 0119. The servings API had no screens.
Contract: `api/brew-servings.md` §6c; plan in backlog item 14.

- **The batch card** on a finished long cold brew's entry: "Made ≈ 320 g ·
  poured 200 g · ≈ 120 g left", the servings (when, who, amounts and the
  strength as drunk, rating, flavors, notes), Log a serving, Batch finished
  / Reopen. Viewers read it only.
- **Dilution happens in the glass:** the glass's water starts at the
  batch's "Served diluted" × what's poured and stops following once typed.
  **Diluted in the jar** (`brew_logs.jar_water_grams`, on the batch's form)
  is for a batch diluted as a whole: servings pour ready to drink, a
  serving's share is poured ÷ jar (yield + water).
- **Unweighed batch:** the first serving's form asks for the concentrate
  made (saved on the brew); otherwise the stock shows "≈".
- **Deleting:** a batch with servings lists them and who logged them and
  asks for "I understand" (rule 7); a serving deletes with a plain confirm.
- **Lists:** Journal cards show "≈ 120 g left" or "Finished"; the Brew page
  has an "In the fridge" card of open batches (on trial).

## Other items on the menu (built)

Branch `menu-custom-items`, migration 0120. A menu item could only be a
drink, a brewer or the beans block, so a pastry or "ask about our decaf"
couldn't go on the menu. Contract: `api/menu.md` §7b "Other items",
`api/public-menu.md` §7; was backlog item 23.

- **Their own list** (`menu_other_items`: name, description), managed in an
  "Other items" dialog in the builder and offered in the add picker beside
  drinks and plain brews. A first take kept them inline on the menu item;
  deleting a section would have erased them, so they became a list.
- **Placed like drinks** (`itemType: "other"`, `menu_items.other_item_id`):
  each placement can rename it and has its own price or sizes and
  Available tick; once per section. No method or ingredients switches.
- **Deleting:** a section only takes them off it. Deleting an other item
  takes it off every section, with the usage and "I understand" (rule 7,
  something else uses it) when it's on the menu.
- **Left out for now:** a photo, and turning one into a real drink (backlog 23).
- **Backups and imports:** in `BACKUP_TABLES` above the menu, match key by
  name.

## Resting beans (built)

Branch `bean-resting`, migration 0121. Resting was a home-roasting idea (a
roast's `restDays`, Roast mode's Resting tab, a one-off reminder); any bag
can need to age before it's ready. Contract: `api/beans.md` §4 "Resting",
`api/notifications.md` §1b "Resting beans", `api/roasts.md` §4f.

- **A third state:** Beans has **Active | Resting | Archived** tabs. A
  resting bean has `restingUntil` (its ready day) and stays resting past it
  until someone makes it active; the Resting tab sorts by ready day.
- **Resting is aging:** freezing stops aging, so a frozen bean is always
  active. **Make active…** asks **Make active** or **Freeze and make
  active**; freezing a resting bean ends its rest; a frozen one can't rest.
- **Brew picker:** a resting bean is offered only with its **Show in the
  brew picker while resting** box (`restInBrewPicker`), which starts from
  the person's `restingInBrewPickerDefault` (Settings → Preferences).
- **Reminders:** to whoever set it resting (`restingBy`), from 8:00 local
  on its ready day, then every `restReminderRepeatDays` (a per-person
  setting for all beans, Settings → Notifications; none = once). A tick
  every 15 minutes (`bean-rest-tick`), like recaps; one message per person
  and workspace.
- **Home roasts:** a new roast adds its bean resting for its rest days, or
  active with **Add to Beans as active**. `restDays` is create-only and no
  longer stored; editing a roast leaves the bean's rest alone. The
  migration moved roasts still resting onto their beans.
- **Backups:** version 6 drops `roasts.restDays` from older files; the
  bean columns ride along (a restored resting bean reminds the restorer).
