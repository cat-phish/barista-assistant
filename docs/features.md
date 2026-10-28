# Features

What the app does, briefly, kept up to date as features land. The contracts
are in `schema.md`, `api/` (index in `api/README.md`) and `timer_architecture.md`; upcoming work is in `backlog.md`, and completed
work is in `roadmap.md`.

## Accounts & workspaces
- **Accounts:** email + password; the session is an httpOnly cookie.
- **Notifications:** each person sets up where their reminders go (Settings
  → Notifications): ntfy, Gotify, Pushover, Discord, Telegram, Slack or any
  webhook, each with its own on/off and a **Send test**.
- **Workspaces:** shared spaces (e.g. a household or café) with roles: owner,
  barista (can log and edit), viewer (read-only).
- **Field visibility:** Settings → Fields lets owners hide the optional brew,
  bean and recipe fields the bar doesn't use, for everyone. Hidden fields
  keep what's recorded (shown again when editing something that has a value)
  and still reach the AI.
- **What the AI sees:** Settings → AI lets owners switch off details the
  analysis sends (TDS, water, origin, recipe steps…, grouped by brew, bean,
  recipe and history), for the whole workspace. Switched-off details are left
  out of what's sent and the prompt stops mentioning them. Two history
  switches: send unrated earlier brews with "Suggest parameters", and
  analyze unrated brews at all.
- **Auto-analyze:** also under Settings → AI, off by default. Each rated brew
  gets an AI suggestion 5, 10, 15 or 30 minutes after it's saved (time to fix
  a typo or delete a mistake); one saved to rate later gets it once it's
  rated. Optionally capped at a number a day; asking for one yourself always
  works. Journal cards mark brews not analyzed yet ("Not analyzed") and
  ones on their way ("AI at 9:15"); a failed analysis says why, with Try
  again.
- **Backup and restore:** Settings → Data. Owners download the whole
  workspace as one JSON file (lists, beans, equipment, recipes, drinks, the
  menu, and every brew with its marks, prep, problems and AI suggestions).
  Anyone signed in can restore a backup, from Settings → Data or the
  workspaces page, as a **new** workspace they own: every brew becomes
  theirs, the public menu starts off, members are invited again.
- **Export and import by list:** each list page (beans, recipes, drinks,
  ingredients, brewers, grinders, water, prep items, the journal; brew
  problems in Settings → Lists) exports the items picked in "Select to
  export…" and imports into that list with "Import…". Settings → Data
  exports whole lists, several at once, and imports several at once. What
  items need comes along (a recipe's brewer and grinders, a drink's
  ingredients, a brew's bean). An import previews what's new and what's
  already here by name, and either uses what's here or adds copies
  ("House V60 (2)"); the same brew is never imported twice. Owners only.
- **Spreadsheets (CSV):** the journal (one row per brew, names instead of
  IDs, with the worked-out ratio and extraction) or the beans, from
  Settings → Data. Owners only.
- **Scheduled server backups:** server admins (granted on the server with
  `npm run admin -- grant <email>`) get
  Settings → Server → Backups: a dump of the whole database every day or
  week at a chosen hour, keeping the newest N, in the `backups` folder;
  Back up now, the list with downloads, the last result or error, and how
  to restore one.

## Beans
- Roaster, coffee name, process, **roast level** (light → dark, optional),
  roast date and stock. Optionally the **roast weight loss** (%), which
  tells the AI how developed the roast is.
- **Freezing:** freeze/thaw periods pause the bean's roast age, so "days off
  roast" stays meaningful for frozen coffee.

## Bar setup
One **Bar setup** section with tabs: Brewers, Grinders, Water, Prep and Menu.
Brewers and Grinders are tables like Recipes: filter brewers by type (pour
over, immersion, espresso) and grinders by hand or electric, with a **Show
archived** checkbox when there are archived ones (where Restore is); sort by
any column (name, type, category; power, burrs, adjustment; date added), unset
values last; tap a row to see details and edit or archive it. Filter and sort
are remembered. **Delete** is on the edit page (for brewers, grinders, water,
recipes, drinks, ingredients and prep items): it says what
would be unlinked or removed and asks for "I understand" first.
Adding and editing a brewer, grinder, ingredient or prep item happen on their own page
(the **Add** button sits at the top of each list, like Recipes and Drinks).
- **Grinders:** per workspace, with optional details: stepped/stepless,
  setting range and step size, burr type and size, hand/electric, and
  variable speed with an RPM range. The range and step let the AI talk in
  clicks; brews on a variable-speed grinder record the RPM too. Archive a grinder you've stopped using
  to keep its name in history; deleting it unlinks its brews.
- **Brewers:** whatever makes the coffee (V60, French press, AeroPress, OXO
  Rapid Brewer, an espresso machine). Two separate ideas describe one:
  - **Brew method**, Filter or Espresso: decides the recipe fields, steps
    and timer, and which drinks the brewer can make. It can't change while
    recipes use the brewer.
  - **Category**: your own grouping for the brew page and the menu.
  How a cup is brewed (pour over, immersion, a soup shot) is the recipe's
  **style**, since one brewer can do several; a brewer's row lists its
  recipes' styles.
  Espresso brewers also record what they can do: pre-infusion (none /
  automatic / manual), flow control and pressure control (none / manual /
  programmable). A brewer has an optional category (where it's listed when
  brewing) and can go on the menu as the plain brew, under a menu name
  ("Espresso" for the machine). Archived like grinders once brews used it;
  deleting is refused while recipes use it.
- **Prep:** the prep checklist (WDT, a puck screen, a paper filter…), in
  the order the brew page lists it; drag to reorder or move with ↑/↓ on
  the list, with Archive/Restore and Delete on the edit page. Each item is **offered for** every brew, or for the methods
  and brewers ticked on its page (a paper filter sandwich for Espresso and
  the Oxo Rapid Brewer, not the V60); the list shows which.

Brew problems (Settings → Lists) also support drag reordering, handle arrow
keys and ↑/↓ buttons, including archived entries. Both checklists save their
order immediately and restore it if saving fails.

## Recipes
- **Style** (optional): how the recipe brews, from its brewer's method:
  Pour over, Immersion, Hybrid, Cold brew or Other for filter; Standard,
  Soup or Other for espresso. Descriptive (lists, the brew page, the AI, which judges
  a soup shot as a soup shot); moving a recipe to the other method clears it.
- **List:** a table (Name, Brewer, Style, Dose, Added), filtered by brewer and
  sorted by name, style or date added, from the headers or the Sort menu (phones use the
  menu); tap a row for windows, grind, steps and actions. The filter and sort
  are remembered. Recipes from before dates were tracked date from their
  first brew.
- A recipe belongs to one brewer. **Duplicate** copies one (steps and grind
  starting points included) to adapt it, e.g. for a second espresso machine,
  which is preselected when there is one.
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
  to start and end ("Starts at 0:30 · Ends at 1:15", ≈ after a step that
  waits for a tap), and a line under the steps shows where they end against
  the target finish window ("Steps end at 3:15 · Target finish 3:00–3:30",
  in the warning colour when outside it). Drag to reorder, or insert between
  steps. The last step can run until you finish.
- **Grind starting points** per grinder, and an optional **default grinder**
  that's selected for you when you brew the recipe (otherwise the last
  grinder you used).
- **Default prep:** the prep items (offered for its brewer) that start
  ticked when you brew the recipe; a field you can hide (Settings → Fields).
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
  cold foam: steep peel in cream overnight). Archived ingredients can't be
  added to drinks; deleting one takes it out of its drinks. The list is a table (Name, Type, Used in, Added), filtered by
  type or "Not in any drink", sorted by any column (most-used first, say);
  tap a row for its instructions, the drinks it's in (links) and the units
  they measure it in. Filter and sort are remembered.
- **Drinks:** what you serve. A drink needs a **brew method**, Filter or
  Espresso, not a particular device: any brewer of that method can make it
  (The Atlas on a V60, French press, AeroPress or OXO; a latte on any espresso
  machine), with that brewer's recipes (an optional default recipe is
  preselected when it fits), finished with ingredients in order, each with an amount (a
  number and a unit: fl oz, ml, g, or any typed unit like "pump", which is
  then suggested next time) and a note ("Orange cold foam · 40 g · spooned on
  top"). An optional **default size** (fl oz or ml) is what the amounts are
  for. Optional free-text **instructions** say how to make it. A plain "V60" isn't a
  drink: it's the brewer itself, which can go on the menu (Bar setup →
  Brewers: show on menu, menu name, description, category).
- **Variants:** like cocktail riffs, a drink can be a variant of another
  (Vanilla Latte of Latte, Iced Vanilla Latte of Vanilla Latte). **Make a
  variant** copies the drink into a new, independent one linked to it; later
  changes to either don't carry over. The list shows variants under their
  parent; deleting a drink moves its variants up a level.
- **Categories:** a managed, ordered list ("Espresso milk drinks", "Specialty
  drinks") at the bottom of the **Drinks** page, below the list: add, rename,
  reorder, delete (its drinks become uncategorised). They group drinks under
  "What are you making?" when brewing, after the brew methods, and filter
  the drinks list. The public menu has its own sections.
- **Drinks list:** a table (Name, Category, Brewer, Added), filtered by
  category and sorted by name (variants stay under their parent) or date
  added, from the headers or the Sort menu; tap a row for its recipe,
  ingredients, size and actions. The filter and sort are remembered.

## Brewing
- **Category → Drink → Brewer → Recipe**, the same for everything: pick a
  **category** (Pour Over, Espresso, Specialty Drinks…, then Other for
  uncategorised ones); then a **drink** (variants under their parent) or
  **Just filter coffee / Just espresso** for a plain brew of the category's
  brewers; then a **brewer**: any of the drink's brew method, or the
  category's own for a plain brew, with the default recipe's brewer, else the
  last one used for that method, preselected; then one of that brewer's
  **recipes**. A brewer with no recipes yet is still offered, with "No recipes
  yet: Add a recipe" (opening the recipe form for it). The last choices are
  remembered. Every category is listed: an empty one says so and links to
  adding a drink in it. A category can mix methods (Specialty Drinks: The
  Atlas is filter, Orange Truffle espresso); the drink list then names each
  drink's method. A drink with a default size gets a
  **Size** field: 12 fl oz on an 8 fl oz latte scales every ingredient ×1.5
  (rounded to whole ml/g, 0.1 fl oz, or half pumps/spoons). On a filter
  brewer the coffee batch scales too; an espresso shot stays as the recipe
  says. The size made is saved on the log and shown in the journal, and the
  AI sees the scaled amounts. **Something else (no recipe)** logs a brew
  without one. A drink's ingredients show as **Finish with** on setup; once
  the brew is done, a **Finish the drink** card shows them (scaled) with the
  drink's **instructions** ("Add the syrup to the cup…"), on the log screen
  and after saving. The brew is saved with the drink.
- **Tasting a drink:** for a drink with ingredients the log has two parts:
  **The brew** (optional rating and notes, if you tasted it on its own: the
  shot, or the V60 cup) and **The drink** (rating and notes). Brews served on
  their own keep one rating and notes.
- **Setup:** three cards. **What you're brewing** picks the bean, recipe and
  grinder; **AI suggestion** (Suggest parameters) sits above the batch, so a
  suggested ratio shows up right below it; **Batch and starting point**
  holds the batch, temperature, grind and the rest, shown from the start
  (not only once a bean is picked). The grind pre-fills from your last brew
  of that recipe on that grinder, else the AI suggestion, else the recipe's
  starting point. Start and Log stay disabled until the bean and the batch
  are set, with a line saying what's still missing ("Choose a bean.",
  "Enter a size.").
- **Start delay:** Settings → Brew setup → Timer start offers no delay,
  3 seconds or 5 seconds for each brew type (Filter, Espresso, Stovetop,
  Other), per person. Custom methods follow their underlying type. The timer
  counts down before starting, with Start now to skip it and a beep/vibration where
  supported. Cancel clears it; long cold brews start immediately.
- **Prep on setup:** a **Prep** card above Start lists the prep items
  offered for the recipe's method or brewer, to tick as you get ready.
  The recipe's **default prep** starts ticked; without any, what you last
  ticked with that brewer (if remembered), else nothing. The ticks go to
  the log form, where they can still be changed. Hidden with the Prep field
  (Settings → Fields).
- **Remembered from last time:** a new brew starts with what you chose last
  time on this device: what you're making, the brewer for each method, the
  recipe for each brewer, the bean, the grinder and your last grind with it.
  **Settings → Brew setup** (per person) switches each off, or on for the
  water, the prep checklist (for each brewer) and the drink size (for each
  drink). Archived ones are skipped; a drink's default brewer and recipe
  come first.
- **Batch scaling:** the **ratio** (the 15 in 1:15) starts at the recipe's.
  Typing the dose or the water keeps the other and changes the ratio;
  typing the ratio changes the water; typing the approximate yield (in fl
  oz, ml or both, by your preference) sets dose and water at the ratio.
  Each change updates the yield estimate, and whatever you typed last is
  held. Pour targets scale with the water; step times stay the same. A much bigger or smaller
  dose than the recipe suggests a coarser or finer grind. "Reset to recipe"
  undoes it all.
- **Espresso shots:** the same setup shows dose, ratio and shot weight
  instead. The dose and the ratio move the shot weight; typing the shot
  weight keeps the dose and changes the ratio. The brew records its recipe's
  brewer, so the espresso machine comes with the recipe.
- **Repeat a brew:** setup can be filled from an earlier brew: quick
  buttons for the latest brew of each of the last 3 things you made (a drink,
  or a plain brew of a method; each shows its recipe, bean and date),
  **Pick a brew…** for any other, and **Brew
  again** on every journal entry. It fills the bean (the newest bag of the
  same coffee if that one is archived), what you're making, brewer, recipe,
  drink size, dose and water (espresso: the dose, at the recipe's ratio),
  temperature, grinder, grind and RPM, and the water, and always ticks the
  prep that brew used (not the recipe's default prep). Grinder weights,
  results, ratings and notes start blank, and anything archived since is
  skipped and named. The timer starts when you press Start.
  **Settings → Brew setup** (per person) chooses what's copied: each of
  those but the prep, plus beans in / grounds out, and the earlier tasting
  notes shown as a reminder on the log form.
- **Rate later:** the log form has a **Rate later** box. Tick it and save
  without a rating, and a reminder ("How was it? Rate your brew") arrives
  after your delay (15 min by default), unless you've rated it by then.
  - Its link opens the brew, where any unrated brew has a quick **Rate this
    brew** card; the AI suggestion is offered once it's rated.
  - Settings → Notifications sets the delay and whether the box starts
    ticked. Turning reminders off hides the box; with no service on it's
    greyed out.
- **Abandoning a brew:** during the timer or before the log is saved,
  leaving the page, reloading, or tapping **Brew** again asks "Abandon this
  brew?" first; abandoning goes back to setup with your choices kept. After
  a brew is saved, tapping **Brew** goes straight back to setup.
- **Cold brew:** three cold styles.
  - **Cold brew** and **Kyoto drip** steep or drip for hours. Their
    recipes set a steep window (e.g. 12–18 h), fridge or room, and how it's
    served (e.g. 1 : 1 with water); steps are a checklist.
  - **Start steep** saves the brew as steeping, and the journal shows
    "Steeping since …". Before it starts, the steep window can be changed
    for this brew (the recipe's to begin with); the brew keeps it. A
    reminder comes when the brew's window opens (Settings → Notifications →
    Cold brew). **Finish** on the entry adds the steep time, yield, TDS,
    dilution served and the rating.
  - **Rapid cold brew** (e.g. an OXO Rapid Brewer) uses the normal timer.
    Its target finish can be changed on setup for this brew, and the brew
    keeps it.
  - Both windows are a brew field (Settings → Fields) and a repeat
    option (Settings → Brew setup).
  - All three ask on setup whether it's steeping in the fridge or at room
    temperature (the recipe's, for cold brew and Kyoto drip).
  - All three ask for the dilution served. The AI judges them as served,
    and knows a concentrate's TDS runs high.
- **Iced, brewed hot:** two ways.
  - **Flash chilled** (Japanese iced): ticking it on a filter recipe asks
    for the ice in the server it's brewed onto, in place of the dilution. The ratio and yield count the ice, the pours
    don't, and there's no TDS reading.
  - **Concentrate**: any filter recipe can be served diluted (e.g. 1 : 0.7
    over ice). Its brews ask for the dilution, the TDS is the concentrate's
    and extraction yield works as usual; the AI judges the cup as served.
- **Timer** (pour over and espresso): Previous / Current / Up next cards on
  top, then the buttons, then the clock; the
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
- **Problems:** a checklist on the log form and journal edit of what went
  wrong while brewing (slow drawdown, channeling, a gushing shot, an untared
  scale…), for the recipe's method plus the all-method ones. The list is
  editable in Settings → Lists → Brew problems (add, rename, reorder, set
  the method, archive or delete). The journal shows them, the AI reads them
  as the clearest clues, and Repeat brews never copies them.

## Journal & AI
- **Journal:** every brew, newest first, filterable by bean; entries can be
  edited or deleted.
- **AI analysis:** after a brew, ask for a suggestion; a background worker
  asks the LLM for grind and temperature changes with reasoning, plus one
  next step and how confident it is. For espresso it can also change the
  dose and the shot weight (the ratio). It analyzes that one brew on
  its own: the bean's roast level and age, the recipe, the grinder's details
  and, for espresso, the machine's capabilities and the shot timer's taps;
  earlier brews aren't sent. The brew says how it was served (straight, or
  the drink and its ingredient types), with the brew and drink tastings
  apart. The AI treats the brew's own notes (tasted on its own) as the
  clearest sign of extraction and drink notes as weaker evidence (milk and
  syrup soften sourness and bitterness).
- **Suggest parameters:** on the brew page, before brewing, pick which
  earlier brews the AI compares (this bag's, or this bean's across every
  bag of it whatever the roast date or batch, each with any recipe, this
  recipe or on this brewer; or this brewer's or this recipe's with any
  bean) and up to how
  many (1–20). Each goes with the analysis it got, so the AI sees whether
  that advice helped. It suggests the grind for the grinder chosen, the
  temperature and the ratio, with its reasoning, and fills them in. The
  batch size stays yours: espresso keeps its dose (the shot weight moves),
  and a filter batch keeps what you typed last, or the recipe's water, so
  the cup stays about the same size. **Also suggest** can ask for another
  recipe or brewer for this bean, or another bean in stock for this
  recipe; they show as **Or try**, and tapping one switches the brew page
  to it. Owners pick which are ticked by default under Settings → AI.
- **What was sent to the AI:** every analysis and suggestion keeps the
  instructions and brew details it was sent; "What was sent to the AI" on
  its card shows them. Backups and exports ask whether to include them.
  "Preview what's sent" shows the same before asking, without sending
  anything. Owners set the default under Settings → AI.
- **Your AI prompt:** under Settings → Your AI prompt, each person adds
  their own instructions (taste, kit quirks), and with Advanced rewrites any
  part of the built-in prompt, with Reset to default. It's yours in every
  workspace: your brews' analyses use it, whoever asks, and so does your
  Suggest parameters. "Add a note for the AI" adds a one-off note to one
  request.

## Public menu
- An optional public page per workspace listing beans, plus plain
  **brewers** (under their menu name) and **drinks** marked as shown, in
  sections by category order (name, description, brewer, the parent it's a
  variant of, ingredients; no recipe details).

## App
- Installable PWA, works on phones, offline-cached public menu.

## Planned
Features and ideas not built yet (Settings, editable styles, units, ingredient
stock, the public menu page and more) live in [`backlog.md`](backlog.md).
