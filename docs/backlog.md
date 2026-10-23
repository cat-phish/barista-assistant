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
- A. Settings & configuration: 1–4
- B. Beans: 5
- C. Brewing & logging: 6–8
- D. AI suggestions: 9–11
- E. Insights: 12
- F. Bar & menu: 13–14
- G. Home roasting: 15
- H. Accounts: 16

---

## A. Settings & configuration

Where the app's choices live, and what you can switch on, off or take out.

### 1. Field visibility for brews and beans

- **Status:** idea
- **Why:** the brew form has many optional fields now (roadmap: more brew
  parameters, parts 1–4), and the bean form has about fifteen (roadmap
  phase 5). Not every bar uses a
  refractometer or tracks price, and a long form slows down logging a brew.
  Each bar should show only the fields it uses.
- **Approach:**
  - Settings → **Fields**: one list for the brew form and one for the bean
    form, with a switch for each optional field:
    - **brew:** grind speed, beans in / grounds out, TDS, water profile,
      prep tools, temperature…;
    - **bean:** process, producer, region, altitude, flavor profile, origin
      (blend type), decaf, roasted for, roast date, roast level, bag price
      and bag weight, purchase date, green bean supplier, website, rating,
      notes, and photos once item 5 exists.
  - Required fields (bean, dose, time, and water or shot weight by method)
    can't be switched off.
  - Stored as a list of hidden field keys. Hiding a field only hides it in
    the forms: its saved values stay, and the history still shows them.
  - The frontend has one field registry (key, label, form, required) that
    the forms and the Settings tab both read.
- **Size:** M
- **Depends on:** nothing: the brew fields are built.
- **Open questions:**
  - Per workspace (the bar's standard form) or per person?
  - Should hidden fields be left out of the AI prompt as well, or does the AI
    use whatever is recorded?

### 2. Backup, restore and export

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
- **Depends on:** nothing. Backups should include photos once 5 is built.
- **Open questions:**
  - Only owners, or all members?
  - Restore into an existing workspace (merge), or only into an empty one?
  - Photos in the backup: a zip, or JSON only, with photos left out?
  - Should there also be scheduled server-side backups (a `mysqldump` cron),
    or is that up to whoever runs the server?

### 3. Where drink categories live

- **Status:** idea
- **Why:** drink categories now only group drinks (brewers are grouped by
  method, the public menu has its own sections). They're managed under Bar
  setup → Categories, next to brewers and grinders, which no longer use
  them.
- **Approach:**
  - Decide their home: a **Drinks** tab (next to Recipes, Drinks and
    Ingredients), or Settings → **Lists** with methods, processes and styles
    (built, roadmap: editable lists; `EditableList.vue` would fit them).
  - Keep what they do now: the drink groups under "What are you making?",
    after the methods, in their order.
- **Size:** S
- **Depends on:** nothing.
- **Open questions:**
  - Should a drink be in more than one category?
  - Should the menu builder offer "add a whole category" as a shortcut?
  - Should a category also order the drinks inside it on the brew page?

### 4. Choose what a repeat keeps

- **Status:** idea
- **Why:** what to carry over differs by bar: some always change the grind,
  others want the tasting notes as a reminder.
- **Approach:** Settings → **Repeat brews**: a switch for each field "Brew
  again" copies, with item 6's choices as the default. Prep tools are one
  of the switches: off, a repeat leaves them unticked; on, it ticks the ones
  the brew used. Uses item 1's field registry.
- **Size:** S
- **Depends on:** 6.
- **Open questions:** per person or per workspace?

---

## B. Beans

What's recorded about each coffee.

### 5. Bean photos

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
  - Photos can be hidden through item 1.
- **Size:** M–L (storage is new to the stack).
- **Depends on:** nothing; 2 should include photos once both exist.
- **Open questions:**
  - Storage: a Docker volume on local disk, or S3-compatible storage
    (MinIO)?
  - Size limits, and does the PWA cache the photos for offline use?
  - Could a label photo fill in the bean form (AI reading the label)?

---

## C. Brewing & logging

Recording a brew: what's measured, and how fast it is to log.

### 6. Repeat a brew

- **Status:** idea
- **Why:** dialing in usually means "same as last time, one click finer".
  Typing every value again is slow and invites mistakes.
- **Approach:**
  - A **Brew again** action on a brew log (and "repeat last" for a bean or
    recipe) opens the brew form filled in from that log: bean, recipe,
    grinder, drink and size, dose, water, temperature, grind, and the water
    profile. Prep tools start unticked unless item 4 says to keep them.
  - Measured results (time, yield, TDS) and the rating and notes are left
    blank.
  - Done in the frontend from the existing log; no API change.
- **Size:** S–M
- **Depends on:** nothing.
- **Open questions:** should it start the timer straight away for recipes
  with steps?

### 7. Rate later, with reminders

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
  - The same notification code serves item 8's steep timers and item 15's
    resting reminders.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:**
  - The AI analysis uses the rating. Should it wait until the brew is rated
    (or the reminder expires)?
  - A delay per user, per method (espresso is rated sooner), or per brew?
  - The rating link opens in the PWA. What happens if the user isn't signed
    in?

### 8. Cold brew refinements

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
    brew is finished and rated later, when the steep ends. Item 7's
    notifications send the "steep done" reminder.
  - The log records the batch size and the dilution served, so the AI
    (item 9) judges strength correctly.
- **Size:** M
- **Depends on:** 7 for the reminder; the rest can go first.
- **Open questions:**
  - Should a cold brew batch be stock, like item 13's ingredient batches,
    with servings taken from it?
  - Are there other long brews to cover the same way (e.g. Kyoto-style cold
    drip)?

---

## D. AI suggestions

What the analysis worker sends to the LLM and what comes back.

### 9. Review and refine AI input and output

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
  - Check the newer brew fields help (TDS and EY, water, prep tools, grind
    speed, grinder retention), as well as the bean details from roadmap
    phase 5.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:**
  - Should users be able to rate a suggestion (useful / not), to measure it?
  - Which model and cost per analysis is acceptable?

### 10. Espresso dose and yield suggestions from the AI

- **Status:** idea
- **Why:** the AI suggests grind and temperature changes; for espresso, dose
  and shot weight (ratio) are often the better lever.
- **Approach:** extend the structured output (`docs/api/README.md` §9) with
  optional dose and yield deltas for espresso brews, and show them with the
  suggestion. Prompt and schema change, plus UI.
- **Size:** S–M
- **Depends on:** nothing. Fits with 9.
- **Open questions:** should it also suggest pre-infusion and profile changes
  for machines that support them?

### 11. Choose what the AI sees

- **Status:** idea
- **Why:** every recorded brew, bean and recipe detail goes to the AI, and
  the list keeps growing (TDS, water profiles, prep tools…). Some details
  don't help a given bar, cost tokens, or (like water minerals someone
  guessed) mislead.
- **Approach:** Settings → **AI**: a switch for each detail the analysis can
  send, grouped as in `docs/api/llm-contract.md` §9: brew (TDS and
  extraction, temperature, marks, prep tools…), water profile (name, each
  mineral), bean (origin, altitude, process, flavor profile…), recipe and
  equipment. All on by default. The worker leaves out what's switched off,
  and the prompt doesn't mention it.
- **Size:** M
- **Depends on:** nothing. Fits with 9 (the audit says what's worth sending) and
  1 (the same field keys).
- **Open questions:**
  - Per workspace, or per person?
  - Should switching a detail off also hide it in the forms (item 1), or are
    the two separate?

---

## E. Insights

### 12. Statistics and graphs

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
    - EY against TDS, with the target box (brews record TDS);
    - coffee used and stock left per bean.
  - The backend adds aggregate endpoints under `/api/workspaces/:id/stats`
    instead of sending every log to the client.
- **Size:** M–L
- **Depends on:** nothing.
- **Open questions:**
  - Charting library (Chart.js, ECharts, or plain SVG)?
  - The whole workspace, or each person's brews by default?

---

## F. Bar & menu

### 13. Ingredient prep and stock

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

### 14. Public menu: branding and sizes

- **Status:** idea
- **Why:** the guest page (`/menu/:slug`, roadmap) has one clean look for
  every bar, and a drink has one price even when it's made in several sizes.
- **Approach:**
  - **Branding:** per-workspace accent colour, a tagline under the name, and
    maybe a logo (uploads are new to the stack, like item 5's photos).
  - **Sizes:** prices per serving size once drinks have more than one size.
- **Size:** S–M (branding without a logo is S).
- **Depends on:** nothing; a logo fits with 5.
- **Open questions:** should the guest page offer "install" as its own app,
  separate from the journal?

---

## G. Home roasting

### 15. Roasting: green stock, roast logs, resting

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
    through item 7's notifications.
  - Ratings for brews of a roasted bean link back to its roast, so roasts can
    be compared.
- **Size:** L (several branches: green stock and roast log, then resting and
  reminders, then roast comparison).
- **Depends on:** 7 (reminders); 5 for photos.
- **Open questions:**
  - Its own section, or a part of Beans?
  - Import roast curves (Artisan `.alog`), or only link to them?
  - Rest time per roast, or a default by roast type (filter vs. espresso)?

---

## H. Accounts

### 16. Account management and password reset

- **Status:** idea. Settings → Account (change password, delete account)
  is built (roadmap, Settings); the rest is left.
- **Why:** a forgotten password can only be fixed by editing the database by
  hand, and there's no way to change your email or see who's logged in.
- **Approach:** in Settings → Account and the login screen:
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
- **Size:** M (script S; owner reset links M; email M).
- **Depends on:** nothing.
- **Open questions:**
  - Should owners be able to reset another member's password, or only
    create a link the member uses themselves?
  - Email (SMTP) at all, or are the script and owner links enough for a
    home server?
  - Must new passwords meet rules beyond 8 characters?
