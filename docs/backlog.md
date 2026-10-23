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
- A. Settings & configuration: 1–2
- B. Beans: 3
- C. Brewing & logging: 4–6
- D. AI suggestions: 7–10
- E. Insights: 11
- F. Bar & menu: 12–14
- G. Home roasting: 15
- H. Accounts: 16

---

## A. Settings & configuration

Where the app's choices live, and what you can switch on, off or take out.

### 1. Backup, restore, import and export

- **Status:** idea
- **Why:** the journal is months of brews and dialing-in. There's no way to
  keep a copy, move it to another server, or look at it in a spreadsheet.
  Setting up a second workspace (or sharing a recipe or bean list with
  another bar) means typing everything again.
- **Approach:**
  - Settings → **Data**.
  - **Backup:** download a versioned JSON file of the workspace (beans and
    freezes, grinders, brewers, water profiles, prep tools, recipes, drinks,
    ingredients, brew logs, AI analyses).
  - **Restore:** upload a backup into a new, empty workspace, with every ID
    remapped. The file's schema version is checked and older versions are
    upgraded.
  - **Export:** CSV of brew logs and beans for spreadsheets, with names
    resolved (bean, recipe, grinder) instead of IDs.
  - **Import and export by list (JSON):** beans, journal entries (brew
    logs), recipes, drinks, ingredients, brewers, grinders, water profiles
    and prep tools, each on its own. Each list page (or Settings → Data)
    gets an **Export** of all or the selected items, and an **Import** that
    adds them to the current workspace.
    - Same versioned format as the backup, one section per list, so a
      backup file can also be imported a list at a time.
    - References go by name, not ID (a recipe's brewer and grinders, a
      drink's recipe and ingredients, a brew's bean, recipe, grinder, water
      and tools). On import, a name that exists is matched; a missing one is
      either brought along from the file or reported.
    - Before anything is saved, a preview shows what will be added, matched
      or skipped (e.g. a bean or grinder whose name already exists), then
      the import runs in one transaction.
    - Workspace lists (methods, processes, styles) match by name too, and
      unknown ones are created, like custom methods.
  - Done by the backend in one transaction; a large export could become a
    worker job.
- **Size:** L (export S, backup M, restore M, list import/export M). A
  sensible order: list export → list import → backup → restore.
- **Depends on:** nothing. Backups should include photos once 3 is built.
- **Open questions:**
  - Only owners, or all members?
  - Restore into an existing workspace (merge), or only into an empty one?
    List import already merges, so a full restore could be "import
    everything".
  - Duplicates on import: skip, rename ("House V60 (2)") or update the
    existing item? Maybe a choice in the preview.
  - Journal entries: bring their AI analyses and timer marks along, or only
    the brew itself?
  - Does exporting a recipe or drink include what it needs (its brewer,
    grinders, ingredients) by default?
  - Photos in the backup: a zip, or JSON only, with photos left out?
  - Should there also be scheduled server-side backups (a `mysqldump` cron),
    or is that up to whoever runs the server?

### 2. Choose what a repeat keeps

- **Status:** idea
- **Why:** what to carry over differs by bar: some always change the grind,
  others want the tasting notes as a reminder.
- **Approach:** Settings → **Repeat brews**: a switch for each field "Brew
  again" copies, with today's choices as the default (roadmap: repeat a
  brew). Prep tools are one
  of the switches: off, a repeat leaves them unticked; on, it ticks the ones
  the brew used. Uses the field registry (`lib/fields.ts`, roadmap: field
  visibility).
- **Size:** S
- **Depends on:** nothing: repeating is built.
- **Open questions:** per person or per workspace?

---

## B. Beans

What's recorded about each coffee.

### 3. Bean photos

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
  - Photos get a field registry entry, so Settings → Fields can hide them.
- **Size:** M–L (storage is new to the stack).
- **Depends on:** nothing; 1 should include photos once both exist.
- **Open questions:**
  - Storage: a Docker volume on local disk, or S3-compatible storage
    (MinIO)?
  - Size limits, and does the PWA cache the photos for offline use?
  - Could a label photo fill in the bean form (AI reading the label)?

---

## C. Brewing & logging

Recording a brew: what's measured, and how fast it is to log.

### 4. Cold brew refinements

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
    brew is finished and rated later, when the steep ends. The notification
    channels (Settings → Notifications, roadmap: rate later) send the "steep
    done" reminder, as another kind of job.
  - The log records the batch size and the dilution served, so the AI
    (item 7) judges strength correctly.
- **Size:** M
- **Depends on:** nothing: the notification channels are built.
- **Open questions:**
  - Should a cold brew batch be stock, like item 12's ingredient batches,
    with servings taken from it?
  - Are there other long brews to cover the same way (e.g. Kyoto-style cold
    drip)?

### 5. Grind settings for multi-ring grinders

- **Status:** idea
- **Why:** grind settings are numbers on the grinder's dial now (roadmap:
  numeric grind settings), which suits most grinders. Some grinders count in
  rings instead: a 1Zpresso says "2.1.0" (rotation, number, click), which
  isn't a decimal.
- **Approach:**
  - A grinder gets a display format, e.g. plain number or rotation.number.click,
    with the clicks per number and numbers per rotation.
  - The stored setting stays one number (total clicks), so ranges, steps,
    last-setting and the AI keep working; the forms and journal show and
    take it in the grinder's format.
  - The number pad stays: the grind boxes are text inputs with
    `inputmode="decimal"`, which picks the keyboard but doesn't limit what's
    typed, so "2.1.0" goes in. For a ring-format grinder the parser reads it
    (or "2,1,0", since comma-decimal phones show "," on the pad) as total
    clicks; other grinders keep the plain-number parse. Don't switch to
    `type="number"`, which refuses a second dot.
- **Size:** S–M
- **Depends on:** nothing.
- **Open questions:**
  - Which grinders need it (1Zpresso, Kingrinder, Timemore with a dial)?
  - Should the AI see the total clicks, the formatted text, or both?

### 6. Brew problems

- **Status:** idea
- **Why:** tasting notes say how the cup tasted, but not what went wrong
  while brewing ("the drawdown stalled", "the shot channeled"). Those are
  the clearest clues for the next brew. As free text they're easy to forget
  and hard for the AI (or a chart) to count.
- **Approach:**
  - A **Problems** checklist on the brew log form (and journal edit),
    like the prep checklist: tick what happened, all unticked to start.
  - The problems come from an editable list per workspace (Settings →
    Lists, like processes and styles), each for one method or all
    methods. Seeded with:
    - **Filter (pour over, immersion):**
      - slow drawdown / stalled bed;
      - fast drawdown;
      - uneven or cratered bed;
      - grounds high on the walls;
      - channeling (holes in the bed);
      - filter clogged or collapsed;
      - poured too fast or uneven;
      - missed a pour target;
      - water too hot or cold (kettle off);
      - immersion: grounds didn't sink, crust didn't break.
    - **Espresso:**
      - channeling / spurting;
      - shot ran fast (gushed);
      - shot choked or dripped slowly;
      - uneven extraction (one spout first, blonding early);
      - puck wet or soupy;
      - puck cracked or stuck to the screen;
      - grinder clumping;
      - dose spilled or uneven tamp;
      - machine temperature not settled.
    - **All methods:** stale or old beans, grind setting changed by
      mistake, scale not tared, distracted / timer missed.
  - Brews record the problem ids (like prep tools, `brew_log_problems`);
    the journal shows them ("Problems: slow drawdown · channeling").
  - The AI gets each brew's problems by name, and is told an empty list
    means none were recorded.
  - **Field visibility:** "Problems" gets a field registry entry
    (`brew.problems`, `lib/fields.ts`), so Settings → Fields → Brews can
    turn the whole checklist off, as the rule in `CLAUDE.md` requires.
- **Size:** M (a list like prep tools, the brew form, the journal, the AI).
- **Depends on:** nothing.
- **Open questions:**
  - Can a problem be switched off on its own (hidden from the checklist
    but kept on old brews), or only archived like prep tools?
  - Should statistics (item 11) chart problems over time, e.g. how often
    a bean channels?
  - Add a free-text "other problem" line, or leave that to the tasting
    notes?

---

## D. AI suggestions

What the analysis worker sends to the LLM and what comes back.

### 7. Review and refine AI input and output

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
  - Where is the model configured: in Docker (`OPENAI_MODEL`, today), in the
    app (Settings → AI, so a bar can switch models or providers without a
    redeploy), or both (Docker sets the key and what's allowed, the app picks
    from that)?

### 8. Espresso dose and yield suggestions from the AI

- **Status:** idea
- **Why:** the AI suggests grind and temperature changes; for espresso, dose
  and shot weight (ratio) are often the better lever.
- **Approach:** extend the structured output (`docs/api/README.md` §9) with
  optional dose and yield deltas for espresso brews, and show them with the
  suggestion. Prompt and schema change, plus UI.
- **Size:** S–M
- **Depends on:** nothing. Fits with 7.
- **Open questions:** should it also suggest pre-infusion and profile changes
  for machines that support them?

### 9. Choose what the AI sees

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
  - **Unrated brews:** a switch for whether brews without a rating (e.g.
    saved with Rate later and not rated yet) go to the AI at all, as the
    brew analysed or as history.
- **Size:** M
- **Depends on:** nothing. Fits with 7 (the audit says what's worth sending).
  Can reuse the field registry's keys (`lib/fields.ts`, roadmap: field
  visibility).
- **Open questions:**
  - Per workspace, or per person?
  - Decided with field visibility: hiding a form field doesn't change what
    the AI gets, so the two stay separate switches.

### 10. Build bar items from plain text (AI)

- **Status:** idea
- **Why:** recipes, drinks and other bar items often come as text: a
  roaster's brew guide, a recipe from a video description, a drink from a
  café menu, notes in a messages app. Retyping them into the Add pages is
  slow.
- **Approach:**
  - Paste text (or later a photo of it) on an **Import from text** page and
    say what it is (recipe, drink, ingredient, brewer, bean…), or let the AI
    tell.
  - A worker job (BullMQ, like the analysis) asks the LLM, with Structured
    Outputs, to turn it into the **import JSON format** from item 1, filling
    only what the text says.
  - The result opens the import preview, or the matching **Add** page
    prefilled, with what was filled marked. The user edits, then adds it
    as usual; nothing is saved without that step.
  - Names that match existing items (a brewer, an ingredient) are linked,
    as in item 1's import.
- **Size:** M
- **Depends on:** 1 (the import format and preview).
- **Open questions:**
  - One item per paste, or several (a guide with three recipes)?
  - Should it take a URL and fetch the page, or only pasted text?
  - Units and step types the text describes loosely ("pour to about 100 ml,
    wait 30 s"): how sure must the AI be before filling a field?

---

## E. Insights

### 11. Statistics and graphs

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

### 12. Ingredient prep and stock

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

### 13. Public menu: branding and sizes

- **Status:** idea
- **Why:** the guest page (`/menu/:slug`, roadmap) has one clean look for
  every bar, and a drink has one price even when it's made in several sizes.
- **Approach:**
  - **Branding:** per-workspace accent colour, a tagline under the name, and
    maybe a logo (uploads are new to the stack, like item 3's photos).
  - **Sizes:** prices per serving size once drinks have more than one size.
- **Size:** S–M (branding without a logo is S).
- **Depends on:** nothing; a logo fits with 3.
- **Open questions:** should the guest page offer "install" as its own app,
  separate from the journal?

### 14. Drink categories: what else they could do

- **Status:** idea
- **Why:** categories now live on the Drinks page and only group drinks when
  brewing (roadmap: drink categories move to the Drinks page). Two ideas
  from that item weren't built.
- **Approach:** decide the open questions first; each is small.
- **Size:** S
- **Depends on:** nothing.
- **Open questions:**
  - Should the menu builder offer "add a whole category" as a shortcut,
    adding every drink in it to a menu section?
  - Should a category also order the drinks inside it on the brew page
    (today they're sorted by name)?

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
    through the notification channels (roadmap: rate later).
  - Ratings for brews of a roasted bean link back to its roast, so roasts can
    be compared.
- **Size:** L (several branches: green stock and roast log, then resting and
  reminders, then roast comparison).
- **Depends on:** 3 for photos.
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
