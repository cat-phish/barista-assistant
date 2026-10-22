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
- A. Settings & configuration: 1–5
- B. Beans: 6–7
- C. Brewing & logging: 8–11
- D. AI suggestions: 12–13
- E. Insights: 14
- F. Bar & menu: 15–16
- G. Home roasting: 17

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
    (item 2), **Units & defaults** (item 3) and **Workspace** (name, slug,
    public menu switch, members), the last moving from the workspace screen.
    Later tabs: **Fields** (item 4), **Data** (backup, restore, export, item
    5), **Repeat brews** (item 10) and **Notifications** (item 11).
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
  - Should drink categories move here from Bar setup → Categories?
  - Which settings are per workspace and which per person?

### 2. Editable style lists

- **Status:** idea
- **Why:** recipe styles are a fixed list (filter: pour over, immersion,
  hybrid, cold brew, other; espresso: standard, soup, other). Bars will want
  their own, e.g. "Inverted", "Bypass", "Turbo shot".
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
- **Size:** M
- **Depends on:** 1 (Settings, for where it's managed).
- **Open questions:**
  - Can built-ins be renamed, or only hidden?
  - What happens to recipes when their style is deleted: refuse, or clear
    the style?

### 3. Units and defaults

- **Status:** idea
- **Why:** the expected-yield estimate assumes a light roast unless the bean
  says otherwise, and weights and volumes show g and fl oz together. Both
  should be choices.
- **Approach:**
  - **Workspace defaults:** the assumed roast level for estimates.
  - **Personal preferences:** volume unit (fl oz / ml) and whether to show
    both.
  - The existing estimate code (`lib/scale.ts`) and size display
    (`lib/servings.ts`) read these instead of constants.
- **Size:** S–M
- **Depends on:** 1.
- **Open questions:** temperature in °F as well?

### 4. Field visibility for brews and beans

- **Status:** idea
- **Why:** items 6 and 8 add many optional fields. Not every bar uses a
  refractometer or tracks price, and a long form slows down logging a brew.
  Each bar should show only the fields it uses.
- **Approach:**
  - Settings → **Fields**: one list for the brew form and one for the bean
    form, with a switch for each optional field (grind speed, TDS, water
    profile, prep tools, temperature…; roast type, blend, decaf, website,
    price, notes, photos…).
  - Required fields (bean, dose, time, and water or shot weight by method)
    can't be switched off.
  - Stored as a list of hidden field keys. Hiding a field only hides it in
    the forms: its saved values stay, and the history still shows them.
  - The frontend has one field registry (key, label, form, required) that
    the forms and the Settings tab both read.
- **Size:** M
- **Depends on:** 1. Most useful once 6 and 8 add fields.
- **Open questions:**
  - Per workspace (the bar's standard form) or per person?
  - Should hidden fields be left out of the AI prompt as well, or does the AI
    use whatever is recorded?

### 5. Backup, restore and export

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
- **Depends on:** 1. Backups should include photos once 7 is built.
- **Open questions:**
  - Only owners, or all members?
  - Restore into an existing workspace (merge), or only into an empty one?
  - Photos in the backup: a zip, or JSON only, with photos left out?
  - Should there also be scheduled server-side backups (a `mysqldump` cron),
    or is that up to whoever runs the server?

---

## B. Beans

What's recorded about each coffee.

### 6. More bean details

- **Status:** in progress (branch `bean-details`). Decided: the detailed
  roast level sits beside `roastLevel` and fills it in the form; the price is
  per bag, on the bean, with a 3-letter currency code.
- **Why:** a bean is a roaster, name, process, roast level, roast date and
  stock today. What it's roasted for, whether it's a blend, decaf, its price
  and where to buy it again all affect how it's brewed and whether to
  reorder.
- **Approach:**
  - New optional columns on `beans`:
    - **Roast type:** filter / espresso / omni / unknown (a const list, like
      `ROAST_LEVELS`).
    - **Detailed roast level:** cinnamon, light (new England), city, city+,
      full city, full city+, vienna, french, italian.
    - **Blend type:** single origin / blend / other.
    - **Decaf:** a flag.
    - **Website** (URL), **price** (amount + currency, with the bag weight
      so a price per gram can be worked out), and **notes**.
  - Every new field can be hidden through item 4.
  - The AI prompt gets roast type, decaf and blend type (item 12).
- **Size:** M
- **Depends on:** 4 (to hide the fields), though it can ship first.
- **Open questions:**
  - Does the detailed roast level replace `roastLevel` or sit beside it?
    The yield estimate and the AI use the 5-step `ROAST_LEVELS`. Suggestion:
    keep both, and have each detailed level set the 5-step one.
  - Is price per bag, or per purchase (a bean bought again)?

### 7. Bean photos

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
  - Photos can be hidden through item 4.
- **Size:** M–L (storage is new to the stack).
- **Depends on:** nothing; 5 should include photos once both exist.
- **Open questions:**
  - Storage: a Docker volume on local disk, or S3-compatible storage
    (MinIO)?
  - Size limits, and does the PWA cache the photos for offline use?
  - Could a label photo fill in the bean form (AI reading the label)?

---

## C. Brewing & logging

Recording a brew: what's measured, and how fast it is to log.

### 8. More brew parameters

- **Status:** idea
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
    - **TDS** (%), with a **refractometer** button that works out extraction
      yield from TDS, yield and dose: `EY = TDS × beverage weight / dose`.
      For immersion, beverage weight is estimated from water and retained
      liquid. EY is shown, not stored.
  - Every new field can be hidden through item 4.
  - The AI prompt gets them (item 12); TDS and EY are the most useful.
- **Size:** L. Can be split: TDS and EY first, then water and tools, then
  weights and RPM.
- **Depends on:** 4 (so the form doesn't get crowded).
- **Open questions:**
  - Are tools and water profiles reusable lists (with minerals for water) or
    free text?
  - Should a recipe set default tools and water?

### 9. Repeat a brew

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

### 10. Choose what a repeat keeps

- **Status:** idea
- **Why:** what to carry over differs by bar: some always change the grind,
  others want the tasting notes as a reminder.
- **Approach:** Settings → **Repeat brews**: a switch for each field "Brew
  again" copies, with item 9's choices as the default. Uses item 4's field
  registry.
- **Size:** S
- **Depends on:** 1, 9.
- **Open questions:** per person or per workspace?

### 11. Rate later, with reminders

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
  - The same notification code serves item 17's resting reminders.
- **Size:** M
- **Depends on:** 1.
- **Open questions:**
  - The AI analysis uses the rating. Should it wait until the brew is rated
    (or the reminder expires)?
  - A delay per user, per method (espresso is rated sooner), or per brew?
  - The rating link opens in the PWA. What happens if the user isn't signed
    in?

---

## D. AI suggestions

What the analysis worker sends to the LLM and what comes back.

### 12. Review and refine AI input and output

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
  - Add the new fields from items 6 and 8 once they exist.
- **Size:** M
- **Depends on:** nothing; repeat after 6 and 8.
- **Open questions:**
  - Should users be able to rate a suggestion (useful / not), to measure it?
  - Which model and cost per analysis is acceptable?

### 13. Espresso dose and yield suggestions from the AI

- **Status:** idea
- **Why:** the AI suggests grind and temperature changes; for espresso, dose
  and shot weight (ratio) are often the better lever.
- **Approach:** extend the structured output (`docs/api/README.md` §9) with
  optional dose and yield deltas for espresso brews, and show them with the
  suggestion. Prompt and schema change, plus UI.
- **Size:** S–M
- **Depends on:** nothing. Fits with 12.
- **Open questions:** should it also suggest pre-infusion and profile changes
  for machines that support them?

---

## E. Insights

### 14. Statistics and graphs

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
    - EY against TDS, with the target box (once 8 records TDS);
    - coffee used and stock left per bean.
  - The backend adds aggregate endpoints under `/api/workspaces/:id/stats`
    instead of sending every log to the client.
- **Size:** M–L
- **Depends on:** nothing; the TDS chart needs 8.
- **Open questions:**
  - Charting library (Chart.js, ECharts, or plain SVG)?
  - The whole workspace, or each person's brews by default?

---

## F. Bar & menu

### 15. Ingredient prep and stock

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

### 16. Public menu page

- **Status:** idea
- **Why:** the public menu API exists (sections by category, brewers and
  drinks, beans) but nothing shows it.
- **Approach:** a public, read-only page at `/menu/:slug` that works offline
  (the PWA cache is already planned in `timer_architecture.md`). It shows the
  sections, then beans.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:** styling and branding per workspace?

---

## G. Home roasting

### 17. Roasting: green stock, roast logs, resting

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
    roast date, the detailed roast level from item 6) marked as resting until
    a set day, then ready.
  - **Reminders** when a roast has finished resting or green stock is low,
    through item 11's notifications.
  - Ratings for brews of a roasted bean link back to its roast, so roasts can
    be compared.
- **Size:** L (several branches: green stock and roast log, then resting and
  reminders, then roast comparison).
- **Depends on:** 11 (reminders), 6 (detailed roast level); 7 for photos.
- **Open questions:**
  - Its own section, or a part of Beans?
  - Import roast curves (Artisan `.alog`), or only link to them?
  - Rest time per roast, or a default by roast type (filter vs. espresso)?
