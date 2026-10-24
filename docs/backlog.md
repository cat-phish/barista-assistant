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
- D. AI suggestions: 7–11
- E. Insights: 12
- F. Bar & menu: 13–15
- G. Home roasting: 16
- H. Accounts: 17
- I. Deployment & the app: 18

---

## A. Settings & configuration

Where the app's choices live, and what you can switch on, off or take out.

### 1. Backup, restore, import and export

- **Status:** in progress. **Backup and restore are built** (branch
  `backup-restore`, `docs/api/backup.md` §2b, roadmap "Backup and
  restore"); CSV export and import/export by list remain, built on the same
  file format.
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

### 2. Import from Beanconqueror

- **Status:** idea
- **Why:** anyone coming from Beanconqueror has months of beans, grinders,
  brewers and brews there. Typing them in again isn't realistic, so the
  history (the best part of a journal) gets left behind.
- **Approach:**
  - Settings → Data → **Import from Beanconqueror**: upload its export
    file, see a preview, then import into the current workspace.
  - Built on item 1's import: references by name, the same preview of
    what's added, matched or skipped, one transaction.
  - What maps where:
    - **Settings:** units and temperature into preferences / workspace
      defaults, where they have a match.
    - **Brewers:** its preparation methods become brewers (with a method
      kind), and their tools become prep tools.
    - **Grinders** and **water profiles** from its mills and water.
    - **Beans:** roaster, name, roast date, process, origin, weight and
      notes.
    - **Recipes:** from whatever the export holds for a preparation's
      usual brew (see open questions).
    - **Journal:** brews become brew logs (dose, water, yield, temperature,
      grind, time, TDS, rating, notes), linked to the bean, brewer, grinder
      and water by name.
  - Fields with no home go into the notes instead of being dropped, and the
    preview lists them.
- **Size:** M–L (parsing and mapping; the import itself is item 1's).
- **Depends on:** 1 (the import format, matching by name and the preview).
- **Open questions:**
  - Which Beanconqueror export versions to support, and the file format
    (its zip with a JSON inside, or the JSON alone)?
  - Does it hold anything like our recipes, or are they built from a
    preparation's typical brew, or skipped?
  - Ratings: how its scale maps to our 1–5 (and the drink rating).
  - Grind settings that are text rather than a dial number.
  - Photos: bring them along once bean photos (item 3) exist?
  - Run it once (a migration into a fresh workspace), or again later
    without duplicating what came in before?

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

### 4. Iced and flash-chilled styles

- **Status:** idea, needs workshopping.
- **Why:** cold brew is built (roadmap: cold brew refinements), but iced
  coffee is often brewed hot and chilled on the spot: **Japanese iced**
  (pour over brewed straight onto ice), or a hot concentrate diluted with
  ice. The ice is part of the recipe's water, which the ratio, the yield
  estimate and extraction yield don't account for today.
- **Approach (to workshop):**
  - Styles that brew like pour over (or immersion), plus an **ice** amount:
    "250 g total: 150 g hot water + 100 g ice".
  - The ratio shown as coffee : total liquid, with the hot water and the ice
    apart. Pour targets count the hot water only.
  - The brewed yield is measured after the ice melts (or estimated), and
    extraction yield uses the hot water and the coffee in it, not the
    melted ice.
  - "Diluted with ice" from the cold styles' dilution may cover hot
    concentrates served over ice; decide whether that's one feature or two.
  - The AI is told the brew was flash-chilled: brighter, more aromatic than
    cold brew, and judged as served.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:**
  - Is ice an ingredient of the recipe (grams), or a recipe field?
  - Which styles: Japanese iced, flash brew, "hot bloom, cold finish"?
  - How is the yield weighed when part of it is ice that hasn't melted?

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

### 6. Change the brew window for any brew on the brew page

- **Status:** idea
- **Why:** cold styles can now change their steep or finish window on
  setup for one brew. Every other brew times against the recipe's target
  finish (and espresso its first-drop window), so trying a longer drawdown
  or a shorter shot means editing the recipe first.
- **Approach:**
  - Show the **Target finish** pair on setup for every timed brew, filled
    from the recipe, with "Use it" to go back, as rapid cold does now.
  - The timer uses it, and it's saved on the brew (`expectedFinishMinSec` /
    `expectedFinishMaxSec` already exist on brew logs); the journal shows
    "target …" and the AI sees it.
  - It stays under the `brew.window` field and the Repeat brews `window`
    option.
- **Size:** S–M
- **Depends on:** nothing.
- **Open questions:**
  - Every brew, or only cold styles as now?
  - Change it on the fly, during the timer, as well as on setup?
  - Espresso's first-drop window too (it would need its own brew columns)?
  - Editable afterwards in the journal? A steeping cold brew's reminder
    would then need re-queuing.

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

### 11. Rework the analysis workflow, with auto-analyze

- **Status:** idea
- **Why:** an AI suggestion only happens when someone taps "Get AI
  suggestion" on the saved screen or "Analyze this brew" in the journal.
  It's easy to forget, so many brews never get one. The flow has also grown
  a piece at a time (saved screen, journal entry, "Suggest parameters" on
  setup, rate later waiting for the rating) and hasn't been looked at as a
  whole.
- **Approach:**
  - **Review the flow end to end:**
    - where a suggestion is asked for, shown and used (saved screen,
      journal, brew setup);
    - what "analyze again" means;
    - whether older analyses stay visible;
    - how it fits with rate later and quick rating.
  - **Auto-analyze** setting: analyze every brew automatically, off by
    default, **after a wait** (e.g. 5–30 min) so a brew deleted or fixed
    right after saving isn't analyzed, or analyzed with typos.
    - Saving queues a **delayed** analysis job (`delay`, same job id per
      brew as today, so a manual request in the meantime reuses it).
    - Editing the brew before it runs pushes the job back or lets it pick
      up the edit. It loads the brew when it runs, so edits are included.
    - **Deleted before it runs:** the worker already completes without
      calling the LLM when the brew log is gone (`docs/api/llm-contract.md`
      §9). Also remove the delayed job when a brew is deleted, test both
      paths, and keep it out of the failure logs.
    - **Rate later:** an unrated brew waits for its rating, or runs once the
      reminder has passed (ties in with item 9's switch for unrated brews).
    - Failures (LLM down, quota) retry as today and show on the journal
      entry with a way to try again, rather than failing silently.
  - Show "Analysis queued for 9:15" on the saved screen and journal entry
    while it waits.
- **Size:** M
- **Depends on:** nothing. Fits with 7 (reviewing input and output) and 9
  (what the AI sees, unrated brews).
- **Open questions:**
  - Per workspace or per person? Auto-analysis costs API calls the
    workspace pays for.
  - How long a wait by default, and can it be skipped ("analyze now")?
  - A daily cap or cost limit on automatic analyses?

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
    - coffee used and stock left per bean;
    - brew problems over time: how often each comes up, by bean, grinder
      or recipe (e.g. how often a bean channels; brews record them since
      migration 0060).
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
- **Open questions:**
  - How precise does stock need to be (exact grams, or "about half left")?
  - Should a finished cold brew batch (roadmap: cold brew refinements) be
    stock the same way, with each glass served taken from it and rated?

### 14. Public menu: branding and sizes

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

### 15. Drink categories: what else they could do

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

### 16. Roasting: green stock, roast logs, resting

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

### 17. Account management and password reset

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

---

## I. Deployment & the app

How the app is served and installed.

### 18. Serve the app as an installable PWA

- **Status:** idea
- **Why:** the PWA is configured (`vite-plugin-pwa`, `frontend/vite.config.ts`)
  but never served. The frontend container runs the Vite **dev server**,
  which doesn't generate the service worker or manifest (only `vite build`
  does). It's also reached over plain HTTP on a LAN IP, and browsers only
  allow service workers and installs over HTTPS (or `localhost`). So
  phones get a browser shortcut, not an app, and nothing works offline.
  Links, like the rate-later reminder's, open in the browser.
- **Approach:**
  - **Production frontend image:** `vite build`, served by Caddy (or nginx),
    which also proxies `/api` to the backend as Vite's dev proxy does now
    (`xfwd`, so `TRUST_PROXY` keeps working). The dev server stays for
    development, e.g. a compose profile or override file.
  - **HTTPS on the LAN.** Options, simplest first:
    - Caddy's internal CA (each device trusts its root once);
    - a real domain with a DNS-challenge certificate;
    - a Tailscale certificate (`*.ts.net`).
    `APP_URL` and `CORS_ORIGIN` then use the https address.
  - **Manifest:**
    - name Barista-Assistant (now "Coffee Brew Journal" / "BrewLog"), and
      a description of what it does now;
    - `id`, `start_url` and `scope` set explicitly;
    - `handle_links: "preferred"` and `launch_handler` (`navigate-existing`),
      so links into the app (reminders) open the installed app on Android.
      iOS always opens links in Safari, whatever the manifest says.
  - Check the service worker's update flow (`registerType: 'autoUpdate'`)
    doesn't reload mid-brew. The timer page could hold the update until the
    brew is saved.
  - Update `docs/timer_architecture.md` §2 and the README's run
    instructions.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:**
  - Which HTTPS route fits: internal CA, own domain, or Tailscale?
  - Keep the dev server as the default `docker compose up`, or make
    production the default and dev an override?
  - Later: **Web Push** from the installed app, as one more notification
    channel next to ntfy and the others (roadmap: rate later)?

