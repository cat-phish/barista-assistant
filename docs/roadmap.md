# Recipe Expansion Roadmap

Design agreed on 2026-10-19. Each phase is its own feature branch off `dev`.
The detailed contracts live in `schema.md`, `api_spec.md` and
`timer_architecture.md` once a phase is built; this file keeps the overall
plan and the decisions behind it.

## Model

| Concept | What it is | Examples |
|---|---|---|
| **Method** | How coffee is extracted. Named by the user, with a fixed `kind`. | V60, AeroPress, Espresso |
| **Recipe** | One way to extract with a method. | "V60 Standard", "1:2 espresso, 8 s pre-infusion" |
| **Component** | A reusable prep with its own instructions. | orange-infused cold foam, steamed oat milk, vanilla syrup |
| **Drink** | What is served and shown on the public menu: a method (any of its recipes) plus components. Can be a variant of another drink. | "Oat Latte", "Vanilla Latte" (variant of Latte), "The Atlas" (V60 + orange cold foam) |
| **Drink category** | An ordered menu section for drinks and plain methods. | "Espresso milk drinks", "Specialty drinks" |
| **Machine** | Equipment, like grinders, with capabilities. | Linea Mini, Gaggia Classic |

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
- **Later:** dose / yield suggestions for espresso from the AI.

## Phase 3: Drinks + components (built)

Built on `feature-drinks`: components and drinks (Recipes / Drinks /
Components tabs), the drink picker when brewing, drinks on brew logs and in
the AI context, the public menu listing drinks, Latte retired.

- A drink has a default recipe; the recipe can be changed at brew time.
- Components are reusable preps (type: milk, foam, syrup, ice, water, other)
  with free-text instructions to start. A drink lists components with an
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
component amounts are a number + unit (free-text amounts were parsed, the
rest moved to the note), so brewing can scale a drink; brew logs record the
size made.

## Phase 4: Flow and pressure profiles (done in 2d)

- Pressure (bar) and flow (g/s or ml/s per recipe) on espresso steps, held or
  ramped, shown by the timer as instructions.
