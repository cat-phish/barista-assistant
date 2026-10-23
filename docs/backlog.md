# Backlog: Planned Features and Ideas

Everything we've decided is worth doing but haven't built. `roadmap.md` is the
history of what was built and why; this file is what's next.

**How to use it:** ask "review the backlog" (or "what should we build
next?"). We go through the items, weigh value against size, and pick one.
The chosen item becomes a plan, then a feature branch off `dev`. When it's
done, it moves to `roadmap.md` with the decisions made along the way.

**Each item** has the same parts:
- **Status:** `idea` (worth noting) → `planned` (approach agreed) →
  `in progress` → done (moved to the roadmap).
- **Why:** the problem it solves.
- **Approach:** a sketch, enough to judge the size; details get decided when
  it's picked.
- **Size:** S (an afternoon), M (a feature branch), L (several branches).
- **Depends on:** other items that should come first.
- **Open questions:** what we'd need to decide before starting.

Items are grouped by area and numbered through the whole file, so "Depends
on: 1" always means the same item. When an item is done or added, renumber
and fix the references.

**Contents**
- A. Settings & configuration: 1–8
- B. Beans: 9
- C. Brewing & logging: 10–13
- D. AI suggestions: 14–15
- E. Insights: 16
- F. Bar & menu: 17–19
- G. Home roasting: 20
- H. Accounts: 21

---

## A. Settings & configuration

Where the app's choices live, and what you can switch on, off or take out.

### 1. Settings section

- **Status:** idea
- **Why:** configuration is hard-coded (recipe styles, the roast level
  recipes assume, display units) or scattered. A Settings section gives these
  one obvious home.
- **Approach:**
  - A **Settings** item in the header nav, with tabs. Start with **Styles**
    (item 2), **Units & defaults** (items 3 and 4) and **Workspace** (name, slug,
    public menu switch, members), the last moving from the workspace screen.
    Later tabs: **Lists** (styles, processes and methods, item 2; maybe drink categories, item 7), **Fields** (item 5),
    **Data** (backup, restore, export, item 6), **Repeat brews** (item 8)
    and **Notifications** (item 12).
  - Two scopes:
    - **workspace settings**, shared by the bar and editable by owners: a
      `workspace_settings` table, or columns on `workspaces`;
    - **personal preferences**, per user (e.g. units shown): a small
      `user_preferences` table, or local storage to start.
  - The Settings tabs read and write through `/api/workspaces/:id/settings`
    and `/api/auth/me/preferences`.
- **Size:** M (the shell and Workspace tab), growing as tabs are added.
- **Depends on:** nothing.
- **Open questions:**
  - Which settings are per workspace and which per person?

### 2. Editable style, process and brewer method lists

- **Status:** idea
- **Why:** recipe styles are a fixed list (filter: pour over, immersion,
  hybrid, cold brew, other; espresso: standard, soup, other). Bars will want
  their own, e.g. "Inverted", "Bypass", "Turbo shot". Bean processes are
  fixed too (`BEAN_PROCESSES`: washed, natural, wet-hulled, honey,
  mechanically washed, anaerobic, carbonic maceration, co-fermentation,
  thermal shock, lactic), and new ones keep appearing (e.g. "Yeast
  inoculated", "Double fermentation").
- **Approach:**
  - A `recipe_styles` table per workspace: `id`, `workspaceId`, `kind`
    (filter/espresso, fixed), `name`, `position`, `hidden`, and `builtin` (the
    original key, e.g. `soup`, or null for custom ones). Seed every workspace
    with today's built-ins.
  - `recipes.style` (a key) becomes `recipes.styleId` (FK). A migration maps
    each key to its seeded row.
  - The brew method stays fixed, because it drives fields, the timer and
    drink compatibility; only styles become editable.
  - The recipe form offers the workspace's visible styles for the brewer's
    method. Settings → Styles is a list per method (add, rename, reorder, hide),
    like Categories.
  - The AI gets the style's name, plus the built-in key when there is one,
    so it still knows that a soup shot is long on purpose.
  - **Brewer methods:** the built-ins are Filter, Espresso, Stovetop and
    Other (`METHOD_KINDS`). A custom method ("Siphon", "Turkish") is based
    on a built-in behaviour, filter-like or espresso-like, which decides the
    recipe fields, the steps and the timer. A `brewer_methods` table per
    workspace (`name`, `position`, `hidden`, `behaviour`, `builtin` key);
    brewers and drinks point at it instead of the fixed `kind`. Brewers are
    grouped by method on the brew page, so these names are what "What are
    you making?" lists first. Settings → **Lists** → Methods.
  - **Processes** work the same way: a `bean_processes` table per workspace
    (`name`, `position`, `hidden`, `builtin` key), seeded from
    `BEAN_PROCESSES`. `beans.process` (a key today) becomes
    `beans.processId`, mapped by a migration. Settings → **Lists** →
    Processes (add, rename, reorder, hide). The AI and public menu get the
    name.
- **Size:** M
- **Depends on:** 1 (Settings, for where it's managed).
- **Open questions:**
  - Can built-ins be renamed, or only hidden?
  - What happens to recipes when their style is deleted: refuse, or clear
    the style?

### 3. Units and defaults

- **Status:** idea
- **Why:** the expected-yield estimate assumes a light roast unless the bean
  says otherwise, weights and volumes show g and fl oz together, and bean
  altitude only shows in metres. These should be choices.
- **Approach:**
  - **Workspace defaults:** the assumed roast level for estimates.
  - **Personal preferences:** volume unit (fl oz / ml) and whether to show
    both; altitude unit (m / ft). Altitude is always stored in metres
    (`beans.altitudeMasl`); the form and lists convert to and from feet
    (1 m = 3.28084 ft) when feet are chosen.
  - The existing estimate code (`lib/scale.ts`) and size display
    (`lib/servings.ts`) read these instead of constants.
- **Size:** S–M
- **Depends on:** 1.
- **Open questions:** temperature in °F as well?

### 4. Roast level scale for beans

- **Status:** idea
- **Why:** the bean form asks for the traditional roast name (Cinnamon,
  City, Full City+ … French) and shows the 5-step level (light … dark) it
  implies. Many bags only say "medium" or "light", and some bars never think
  in City/Full City terms.
- **Approach:**
  - A workspace setting under Settings → **Units & defaults**: roast level
    as **roast names** (today's form) or **light to dark** (the 5-step
    level only).
  - With light to dark, the form shows the 5-step level as an editable
    select and hides the roast name. The API already accepts `roastLevel`
    alone while a bean has no detailed level (`docs/api/beans.md` §4).
  - Lists show whichever the bean has: the roast name if set, else the
    5-step level.
- **Size:** S
- **Depends on:** 1.
- **Open questions:**
  - With light to dark chosen, what happens to a bean that already has a
    roast name: keep it read-only, or let a new 5-step choice clear it?
  - Per workspace, or per person?

### 5. Field visibility for brews and beans

- **Status:** idea
- **Why:** item 10 adds many optional brew fields, and the bean form already
  has about fifteen (roadmap phase 5). Not every bar uses a
  refractometer or tracks price, and a long form slows down logging a brew.
  Each bar should show only the fields it uses.
- **Approach:**
  - Settings → **Fields**: one list for the brew form and one for the bean
    form, with a switch for each optional field:
    - **brew:** grind speed, TDS, water profile, prep tools, temperature…
      (item 10);
    - **bean:** process, producer, region, altitude, flavor profile, origin
      (blend type), decaf, roasted for, roast date, roast level, bag price
      and bag weight, purchase date, green bean supplier, website, rating,
      notes, and photos once item 9 exists.
  - Required fields (bean, dose, time, and water or shot weight by method)
    can't be switched off.
  - Stored as a list of hidden field keys. Hiding a field only hides it in
    the forms: its saved values stay, and the history still shows them.
  - The frontend has one field registry (key, label, form, required) that
    the forms and the Settings tab both read.
- **Size:** M
- **Depends on:** 1, and 10: add the brew fields first, then decide
  what can be hidden.
- **Open questions:**
  - Per workspace (the bar's standard form) or per person?
  - Should hidden fields be left out of the AI prompt as well, or does the AI
    use whatever is recorded?

### 6. Backup, restore and export

- **Status:** idea
- **Why:** the journal is months of brews and dialing-in. There's no way to
  keep a copy, move it to another server, or look at it in a spreadsheet.
- **Approach:**
  - Settings → **Data**.
  - **Backup:** download a versioned JSON file of the workspace (beans and
    freezes, grinders, brewers, recipes, drinks, ingredients, brew logs, AI
    analyses).
  - **Restore:** upload a backup into a new, empty workspace, with every ID
    remapped. The file's schema version is checked and older versions are
    upgraded.
  - **Export:** CSV of brew logs and beans for spreadsheets, with names
    resolved (bean, recipe, grinder) instead of IDs.
  - Done by the backend in one transaction; a large export could become a
    worker job.
- **Size:** M–L (export S, backup M, restore M).
- **Depends on:** 1. Backups should include photos once 9 is built.
- **Open questions:**
  - Only owners, or all members?
  - Restore into an existing workspace (merge), or only into an empty one?
  - Photos in the backup: a zip, or JSON only, with photos left out?
  - Should there also be scheduled server-side backups (a `mysqldump` cron),
    or is that up to whoever runs the server?

### 7. Where drink categories live

- **Status:** idea
- **Why:** drink categories now only group drinks (brewers are grouped by
  method, the public menu has its own sections). They're managed under Bar
  setup → Categories, next to brewers and grinders, which no longer use
  them.
- **Approach:**
  - Decide their home: a **Drinks** tab (next to Recipes, Drinks and
    Ingredients), or Settings → **Lists** with styles, processes and methods
    (item 2).
  - Keep what they do now: the drink groups under "What are you making?",
    after the methods, in their order.
- **Size:** S
- **Depends on:** 1 if they move to Settings.
- **Open questions:**
  - Should a drink be in more than one category?
  - Should the menu builder offer "add a whole category" as a shortcut?
  - Should a category also order the drinks inside it on the brew page?

### 8. Choose what a repeat keeps

- **Status:** idea
- **Why:** what to carry over differs by bar: some always change the grind,
  others want the tasting notes as a reminder.
- **Approach:** Settings → **Repeat brews**: a switch for each field "Brew
  again" copies, with item 11's choices as the default. Uses item 5's field
  registry.
- **Size:** S
- **Depends on:** 1, 11.
- **Open questions:** per person or per workspace?

---

## B. Beans

What's recorded about each coffee.

### 9. Bean photos

- **Status:** idea
- **Why:** a photo of the bag or label is the quickest way to recognize a
  bean and keeps the roaster's details at hand.
- **Approach:**
  - A `bean_photos` table (bean, file key, position, created at), several
    per bean, one marked as the cover.
  - The first file uploads in the app: the backend takes the image, removes
    EXIF, resizes it (full size and a thumbnail) and stores it.
  - The bean list shows the cover thumbnail; the bean page has a gallery.
    On a phone the camera opens directly (`capture` on the file input).
  - Photos can be hidden through item 5.
- **Size:** M–L (storage is new to the stack).
- **Depends on:** nothing; 6 should include photos once both exist.
- **Open questions:**
  - Storage: a Docker volume on local disk, or S3-compatible storage
    (MinIO)?
  - Size limits, and does the PWA cache the photos for offline use?
  - Could a label photo fill in the bean form (AI reading the label)?

---

## C. Brewing & logging

Recording a brew: what's measured, and how fast it is to log.

### 10. More brew parameters

- **Status:** in progress. TDS and extraction yield are done (roadmap:
  "More brew parameters, part 1"); water and tools, then weights and RPM, are
  next.
- **Why:** dose, water, yield, temperature, grind and time leave out things
  that change the cup: retention, grinder speed, the tools used, the water,
  and the extraction actually measured.
- **Approach:**
  - New optional fields on `brew_logs`:
    - **Bean weight in / ground coffee out:** weighed before and after
      grinding, to show retention. `actualDoseGrams` stays the dose that
      went into the brew.
    - **Grind speed** (RPM), for grinders with variable speed (a grinder
      flag says whether to ask).
    - **Prep tools:** filter paper, WDT, puck screen, shaker, RDT…
    - **Water profile:** a named recipe (e.g. "Third Wave Water", "Lotus
      light", tap), probably a per-workspace list like grinders.
  - Every new field can be hidden through item 5.
  - The AI prompt gets them (item 14), as it does TDS and EY.
- **Size:** L, split into parts: TDS and EY (done), then water and tools,
  then weights and RPM.
- **Depends on:** nothing. Item 5 (hiding fields) comes after.
- **Open questions:**
  - Are tools and water profiles reusable lists (with minerals for water) or
    free text?
  - Should a recipe set default tools and water?

### 11. Repeat a brew

- **Status:** idea
- **Why:** dialing in usually means "same as last time, one click finer".
  Typing every value again is slow and invites mistakes.
- **Approach:**
  - A **Brew again** action on a brew log (and "repeat last" for a bean or
    recipe) opens the brew form filled in from that log: bean, recipe,
    grinder, drink and size, dose, water, temperature, grind.
  - Measured results (time, yield, TDS) and the rating and notes are left
    blank.
  - Done in the frontend from the existing log; no API change.
- **Size:** S–M
- **Depends on:** nothing.
- **Open questions:** should it start the timer straight away for recipes
  with steps?

### 12. Rate later, with reminders

- **Status:** idea
- **Why:** coffee often gets rated a while after it's made (once it cools,
  or after the drink is served), and by then the app is closed and the rating
  is forgotten.
- **Approach:**
  - Save a brew with **Rate later**. It shows as unrated in the history and
    on the home screen.
  - A delayed BullMQ job sends a reminder after a set time (e.g. 15 min),
    unless the brew has been rated by then.
  - Delivered with **ntfy.sh** (or a self-hosted ntfy server): each user sets
    a server and topic under Settings → **Notifications**. The message links
    to the brew's rating screen. Web Push could come later.
  - The same notification code serves item 13's steep timers and item 20's
    resting reminders.
- **Size:** M
- **Depends on:** 1.
- **Open questions:**
  - The AI analysis uses the rating. Should it wait until the brew is rated
    (or the reminder expires)?
  - A delay per user, per method (espresso is rated sooner), or per brew?
  - The rating link opens in the PWA. What happens if the user isn't signed
    in?

### 13. Cold brew refinements

- **Status:** idea
- **Why:** cold brew is a recipe style (`cold_brew`), but it's brewed like a
  quick filter: a timer in seconds, water by weight, no dilution. A real cold
  brew steeps for 12–24 hours, is usually a concentrate, and is diluted to
  serve.
- **Approach:**
  - Cold brew recipes:
    - steep time in hours;
    - steep temperature (fridge or room);
    - concentrate ratio, and a serving dilution (e.g. 1:1 with water or
      milk);
    - filtering steps.
  - Brewing a cold brew starts a batch: the start time is logged, and the
    brew is finished and rated later, when the steep ends. Item 12's
    notifications send the "steep done" reminder.
  - The log records the batch size and the dilution served, so the AI
    (item 14) judges strength correctly.
- **Size:** M
- **Depends on:** 12 for the reminder; the rest can go first.
- **Open questions:**
  - Should a cold brew batch be stock, like item 17's ingredient batches,
    with servings taken from it?
  - Are there other long brews to cover the same way (e.g. Kyoto-style cold
    drip)?

---

## D. AI suggestions

What the analysis worker sends to the LLM and what comes back.

### 14. Review and refine AI input and output

- **Status:** idea
- **Why:** the prompt and structured output (`docs/api/llm-contract.md` §9)
  have grown a feature at a time. They haven't been checked as a whole for
  what the model needs, what it ignores, and whether the suggestions are
  specific enough to act on.
- **Approach:**
  - Audit the input: which fields are sent, how they're worded, and how much
    brew history is included (recent brews of the same bean and recipe).
  - Audit the output: whether the schema's fields are used, whether
    suggestions give one clear next step, and how confidence and reasons are
    shown.
  - Build a small set of real brews to compare prompt versions against.
  - Add item 10's brew fields once they exist. The bean details from
    roadmap phase 5 are already sent; check they help.
- **Size:** M
- **Depends on:** nothing; repeat after 10.
- **Open questions:**
  - Should users be able to rate a suggestion (useful / not), to measure it?
  - Which model and cost per analysis is acceptable?

### 15. Espresso dose and yield suggestions from the AI

- **Status:** idea
- **Why:** the AI suggests grind and temperature changes; for espresso, dose
  and shot weight (ratio) are often the better lever.
- **Approach:** extend the structured output (`docs/api/README.md` §9) with
  optional dose and yield deltas for espresso brews, and show them with the
  suggestion. Prompt and schema change, plus UI.
- **Size:** S–M
- **Depends on:** nothing. Fits with 14.
- **Open questions:** should it also suggest pre-infusion and profile changes
  for machines that support them?

---

## E. Insights

### 16. Statistics and graphs

- **Status:** idea
- **Why:** the brew history is a list. Trends (is this bean getting better
  as it rests? which grinder rates higher?) aren't visible.
- **Approach:**
  - A **Stats** item in the nav, filtered by date range, bean, recipe and
    brewer.
  - Possible views:
    - brews per day or week;
    - average rating by bean, recipe, grinder and brewer;
    - rating against roast age, grind setting or ratio (scatter);
    - EY against TDS, with the target box (once 10 records TDS);
    - coffee used and stock left per bean.
  - The backend adds aggregate endpoints under `/api/workspaces/:id/stats`
    instead of sending every log to the client.
- **Size:** M–L
- **Depends on:** nothing; the TDS chart needs 10.
- **Open questions:**
  - Charting library (Chart.js, ECharts, or plain SVG)?
  - The whole workspace, or each person's brews by default?

---

## F. Bar & menu

### 17. Ingredient prep and stock

- **Status:** idea
- **Why:** ingredients like orange cold foam are made in batches, and it
  would help to know what's left and when it was made.
- **Approach:**
  - Batches per ingredient: made on, amount, expires.
  - Brews made for a drink deduct its scaled amounts.
  - Structured ingredient recipes (sub-ingredients, steps) instead of free
    text.
- **Size:** L
- **Depends on:** nothing.
- **Open questions:** how precise does stock need to be (exact grams, or
  "about half left")?

### 18. Public menu page

- **Status:** idea
- **Why:** the public menu API exists, arranged in the menu builder
  (`docs/api/menu.md` §7b: sections, items, prices, availability, the beans
  block), but nothing shows it to guests.
- **Approach:** a public, read-only page at `/menu/:slug` that works offline
  (the PWA cache is already planned in `timer_architecture.md`). It shows the
  builder's sections in order, with prices in the menu's currency,
  unavailable items marked, and the beans block wherever it's placed.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:** styling and branding per workspace?

### 19. Refine the menu builder

- **Status:** idea
- **Why:** the first version of Bar setup → Menu works but doesn't read
  naturally. "+ Add to Coffee" opens a dialog that starts on "A drink", even
  for a section that's meant for the beans; moving and arranging items takes
  several taps; and there's no way to see what guests will see (the guest
  page is item 18).
- **Approach:**
  - **Adding:** a dialog (or inline picker) that starts from what makes sense
    for the section, shows drinks, plain brews and the beans block side by
    side with what's already on the menu marked, and lets several items be
    added at once.
  - **Section kinds**, maybe: a "Coffee" section that is the beans block,
    versus drink sections, so a beans section doesn't offer drinks.
  - **Arranging:** drag and drop (on top of ↑/↓), including between
    sections; the API's `PUT /layout` already takes the whole arrangement.
  - **Preview:** show the menu as guests will see it, next to the editor, so
    the builder and item 18's page stay in step.
  - **Wording:** say plainly what each item shows (its own name and
    description, or the menu's), and where prices and "unavailable" appear.
- **Size:** M
- **Depends on:** nothing; fits with 18 (the guest page).
- **Open questions:**
  - Section kinds (beans vs drinks), or keep every section mixed?
  - Should a section be able to show all of a drink category automatically?
  - Prices per size, once drinks have more than one size?

---

## G. Home roasting

### 20. Roasting: green stock, roast logs, resting

- **Status:** idea
- **Why:** for home roasters, the bean starts as green coffee. Green stock,
  roast results and resting time are tracked in another notebook or not at
  all, and a roast that's ready to drink gets forgotten.
- **Approach:**
  - **Green stock:** green coffees (origin, producer, process, supplier,
    price, weight bought and left).
  - **Roast log:** green coffee, roaster, green weight in, roasted weight
    out (weight loss %), drop temperature, development time, profile notes,
    and an optional curve file or link (e.g. from Artisan).
  - **Resting stock:** each roast creates a `bean` (roaster = "home", the
    roast date, the detailed roast level from roadmap phase 5) marked as resting until
    a set day, then ready.
  - **Reminders** when a roast has finished resting or green stock is low,
    through item 12's notifications.
  - Ratings for brews of a roasted bean link back to its roast, so roasts can
    be compared.
- **Size:** L (several branches: green stock and roast log, then resting and
  reminders, then roast comparison).
- **Depends on:** 12 (reminders); 9 for photos.
- **Open questions:**
  - Its own section, or a part of Beans?
  - Import roast curves (Artisan `.alog`), or only link to them?
  - Rest time per roast, or a default by roast type (filter vs. espresso)?

---

## H. Accounts

### 21. Account management and password reset

- **Status:** idea
- **Why:** a forgotten password can only be fixed by editing the database by
  hand. The API can already change a password and delete an account
  (`docs/api/auth.md` §1), but no screen uses either, and there's no way to
  change your email or see who's logged in.
- **Approach:**
  - An **Account** screen (from the header menu, or a tab of Settings,
    item 1) for what the API already supports:
    - **change password**: current password plus the new one twice; other
      sessions are logged out;
    - **delete account**: re-enter the password, with a warning about the
      workspaces you own.
  - **Change email**, confirmed with the current password.
  - **Log out everywhere**: bump `session_version`, as a password change
    already does.
  - **Forgotten password**, without email to start, since it's self-hosted:
    - a **reset script** for whoever runs the server, e.g.
      `npm run reset-password -w backend -- someone@example.com`. It prints a
      one-time password, saves its hash with `hashPassword`, and logs out
      every session;
    - a **reset link from a workspace owner**: in Members, "Reset password"
      creates a one-time link that expires (e.g. after 1 hour) for the
      owner to send; opening it sets a new password;
    - **email reset** ("Forgot password?" on the login screen) once SMTP
      settings exist, with the same one-time token.
  - Reset tokens are stored hashed, used once, expire, and go through the
    login rate limit.
- **Size:** M (Account screen and script S; owner reset links M; email M).
- **Depends on:** nothing. Fits under Settings (1) if that comes first.
- **Open questions:**
  - Should owners be able to reset another member's password, or only
    create a link the member uses themselves?
  - Email (SMTP) at all, or are the script and owner links enough for a
    home server?
  - Must new passwords meet rules beyond 8 characters?
