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
- A. Settings & configuration: 1
- B. Beans: 2
- C. Brewing & logging: 3–4
- D. AI suggestions: 5–7
- E. Insights: 8
- F. Bar & menu: 9–11
- G. Home roasting: 12
- H. Accounts: 13–14
- I. Deployment & the app: 15

---

## A. Settings & configuration

Where the app's choices live, and what you can switch on, off or take out.

### 1. Import from Beanconqueror

- **Status:** idea
- **Why:** anyone coming from Beanconqueror has months of beans, grinders,
  brewers and brews there. Typing them in again isn't realistic, so the
  history (the best part of a journal) gets left behind.
- **Approach:**
  - Settings → Data → **Import from Beanconqueror**: upload its export
    file, see a preview, then import into the current workspace.
  - Built on the list import (`docs/api/backup.md` §2b, "By list"):
    references by name, the same preview of
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
- **Size:** M–L (parsing and mapping; the import itself is built).
- **Depends on:** nothing (the list import it builds on is done).
- **Open questions:**
  - Which Beanconqueror export versions to support, and the file format
    (its zip with a JSON inside, or the JSON alone)?
  - Does it hold anything like our recipes, or are they built from a
    preparation's typical brew, or skipped?
  - Ratings: how its scale maps to our 1–5 (and the drink rating).
  - Grind settings that are text rather than a dial number.
  - Photos: bring them along once bean photos (item 2) exist?
  - Run it once (a migration into a fresh workspace), or again later
    without duplicating what came in before?

---

## B. Beans

What's recorded about each coffee.

### 2. Bean photos

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
- **Depends on:** nothing. Backups and list exports (`docs/api/backup.md`
  §2b) should then include photos: a zip, or JSON with the photos left out?
- **Open questions:**
  - Storage: a Docker volume on local disk, or S3-compatible storage
    (MinIO)?
  - Size limits, and does the PWA cache the photos for offline use?
  - Could a label photo fill in the bean form (AI reading the label)?

---

## C. Brewing & logging

Recording a brew: what's measured, and how fast it is to log.

### 3. Grind settings for multi-ring grinders

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

### 4. Change the brew window for any brew on the brew page

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

### 5. Build bar items from plain text (AI)

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
    Outputs, to turn it into the **list import format**
    (`docs/api/backup.md` §2b, "By list"), filling
    only what the text says.
  - The result opens the import preview, or the matching **Add** page
    prefilled, with what was filled marked. The user edits, then adds it
    as usual; nothing is saved without that step.
  - Names that match existing items (a brewer, an ingredient) are linked,
    as in the list import.
- **Size:** M
- **Depends on:** nothing (the import format and preview are built).
- **Open questions:**
  - One item per paste, or several (a guide with three recipes)?
  - Should it take a URL and fetch the page, or only pasted text?
  - Units and step types the text describes loosely ("pour to about 100 ml,
    wait 30 s"): how sure must the AI be before filling a field?

### 6. Review and test the espresso dose and shot weight suggestions

- **Status:** planned
- **Why:** dose and shot weight changes for espresso (roadmap: espresso dose
  and shot weight suggestions, prompt `2026-10-c`) were built and unit
  tested, but haven't been tried on real brews: nobody has checked that the
  AI picks a sensible lever, or that the brew page applies it as expected.
- **Approach:**
  - **Eval on real shots:** `npm run eval -w worker -- snapshot`, then
    `run --label after` and `compare baseline after`
    (`docs/api/llm-contract.md` §9, "Evaluating changes"). Look at the
    espresso brews: does it change the ratio when the grind is right but
    the cup is off, and the grind when the shot ran fast or slow? Are the
    sizes sensible (about 0.5–1 g dose, a few grams of shot weight)? Does
    it ever suggest both, or a dose the basket can't hold? Filter brews
    should never get dose or shot weight changes.
  - **In the app:** analyze an espresso brew; check the suggestion card
    ("Dose +0.5 g", "Shot weight +4 g") and the journal entry. On the brew
    page, "Suggest parameters" for that bean: the Starting point shows the
    new values, and the shot's dose, ratio and target weight are set to
    them (a shot that wasn't weighed only gets the dose). Check a recipe
    that differs from the analyzed brew's, and that "Reset to recipe" still
    works.
  - **Rate the results** 👍/👎 on a few shots, so later prompt changes can
    be compared against them.
  - Adjust the espresso section's wording in `worker/src/prompt.ts` if the
    advice reads worse (bump `PROMPT_VERSION`), and note what was found in
    the roadmap entry.
- **Size:** S
- **Depends on:** a few rated espresso brews to analyze.
- **Open questions:**
  - Should pre-infusion and profile changes become fields after all, if
    `nextStep` keeps suggesting them?
  - Should the brew page say when it changed the shot because of the
    suggestion (like it does for the grind)?

### 7. Tailor the AI suggestions: analysis per brew, history on "Suggest parameters"

- **Status:** planned
- **Why:** every analysis sends the brew plus the last 5 brews of its bean,
  and "Suggest parameters" makes no AI call: it reuses the bean's newest
  analysis. Nobody can choose which brews are compared (other recipes or
  brewers of the bean, the recipe with other beans), see what was sent, or
  change the prompt's wording.
- **Approach:** workspace defaults (owners, Settings → AI), changeable each
  time. Branches, in order:
  1. **One brew on its own:** analyzing a brew (journal, auto-analyze)
     sends only that brew, no history.
  2. **Suggest parameters as an AI request:** on the brew page, a dropdown
     picks the brews sent (this bean · bean and recipe · bean and brewer ·
     this brewer · this recipe) and "up to N brews". Each brew goes with its
     own latest analysis. The AI returns actual values for the brew being
     set up (grind for the chosen grinder, temperature, and a ratio for the
     batch, which stays the barista's), which are filled in. Saved in a new `parameter_suggestions`
     table.
  3. **Save what was sent:** each analysis and suggestion keeps its prompt
     and input; "What was sent" shows them.
  4. **Preview:** see the prompt and input before sending, built by the
     worker (no LLM call) so it matches what's really sent.
  5. **Edit the prompt, per barista:** each person tunes the prompt to
     their own taste (often a home with several people), so it's a user
     preference (`docs/api/auth.md` §1), not a workspace setting an owner
     could override. A free-text box for their instructions; an Advanced
     switch shows every built-in section, editable with "Reset to default"
     (the schema sections stay locked); a one-off note each time, for
     baristas as well as owners. Whose prompt: Suggest parameters uses the
     person asking; an analysis uses the brew's barista, also when it runs
     automatically or someone else taps Get AI suggestion. Custom prompts
     are saved as `PROMPT_VERSION+custom`.
  6. **New kinds of suggestion:** another recipe or brewer for this bean,
     another bean in stock for this recipe.
- **Size:** L
- **Depends on:** nothing. Pairs with 6 (eval before and after the prompt
  changes).
- **Open questions:** none.

---

## E. Insights

### 8. Statistics and graphs

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

### 9. Ingredient prep and stock

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

### 10. Public menu: branding and sizes

- **Status:** idea
- **Why:** the guest page (`/menu/:slug`, roadmap) has one clean look for
  every bar, and a drink has one price even when it's made in several sizes.
- **Approach:**
  - **Branding:** per-workspace accent colour, a tagline under the name, and
    maybe a logo (uploads are new to the stack, like item 2's photos).
  - **Sizes:** prices per serving size once drinks have more than one size.
- **Size:** S–M (branding without a logo is S).
- **Depends on:** nothing; a logo fits with 2.
- **Open questions:** should the guest page offer "install" as its own app,
  separate from the journal?

### 11. Drink categories: what else they could do

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

### 12. Roasting: green stock, roast logs, resting

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
- **Depends on:** 2 for photos.
- **Open questions:**
  - Its own section, or a part of Beans?
  - Import roast curves (Artisan `.alog`), or only link to them?
  - Rest time per roast, or a default by roast type (filter vs. espresso)?

---

## H. Accounts

### 13. Account management and password reset

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

### 14. Email verification

- **Status:** idea
- **Why:** anyone can register any address today, and nothing checks it's
  theirs. That's why server admin is granted on the server rather than by
  email, and it limits what an email can be trusted for: password reset
  (item 13), inviting a member by email, or notifications by email.
- **Approach:**
  - On registering (and on any later email change), send a link with a
    short-lived, single-use token; the account is marked verified when it's
    opened. Unverified accounts can sign in but see a "check your email"
    banner with a resend button.
  - Outgoing mail through SMTP settings in `.env` (host, port, user,
    password, from); without them, verification is off and the app says so.
  - Optionally `REQUIRE_VERIFIED_EMAIL=true` to block an unverified account
    from workspaces until it's verified.
  - Shares the mail and token pieces with password reset (item 13).
- **Size:** M (mail is new to the stack).
- **Depends on:** nothing; pairs with 13.
- **Open questions:**
  - Block unverified accounts, or only remind them?
  - What happens to accounts that existed before verification (treat as
    verified, or ask them once)?
  - Rate limits on resending, and how long a link stays valid.

---

## I. Deployment & the app

How the app is served and installed.

### 15. Serve the app as an installable PWA

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

