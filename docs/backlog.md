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
- C. Brewing & logging: 4–7
- D. Recipes: 8–9
- E. AI suggestions: 10–11
- F. Insights: 12
- G. Bar & menu: 13–15
- H. Home roasting: 16
- I. Accounts: 17–18
- J. Deployment & the app: 19

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
  - Photos: bring a bean's photos along (they're built, `bean-photos.md` §4c)?
  - Run it once (a migration into a fresh workspace), or again later
    without duplicating what came in before?

### 2. AI model and API key in Settings

- **Status:** idea
- **Why:** the worker reads `OPENAI_API_KEY`, `OPENAI_MODEL` and
  `OPENAI_BASE_URL` from `.env` (`worker/src/config.ts`) and won't start
  without them. Trying another model or replacing the key means editing
  `.env` and restarting the worker, and a workspace can't use its own key.
- **Approach:**
  - Settings → AI gets a **Model and key** section:
    - **API key:** write-only. Shown as "set, ends in …a1b2" with Replace
      and Remove; never sent back to the browser.
    - **Model:** picked from the provider's model list (`/models`), or typed.
    - **Base URL** (optional), for OpenAI-compatible providers.
    - **Test:** a tiny Structured Outputs call, so a model that can't
      return the analysis schema is caught before a brew is analyzed.
  - The key is stored encrypted (e.g. AES-GCM with a key from `.env`). It
    stays out of backups and list exports (`NOT_BACKED_UP`, or the column
    left out), logs and the saved AI request.
  - The worker reads the settings for each job instead of once at start;
    the `.env` values stay as the default when nothing is set.
  - Analyses already record `model`, so the journal and the eval show
    which model gave which advice.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:**
  - Server-wide (server admin only), per workspace (owners), or a server
    default that a workspace can override?
  - Other providers (Anthropic, a local model), or OpenAI-compatible only?
  - One model for everything, or a smaller one for previews and
    suggestions and a bigger one for analysis?
  - Show usage or cost per workspace?

---

## B. Beans

What's recorded about each coffee.

### 3. Crop photos

- **Status:** idea
- **Why:** a bag photo takes in the counter, a hand and the shelf behind it.
  The cover in the bean list is small, so the bag ends up tiny, and a label
  photo with less around it may read better.
- **Approach:**
  - A **Crop** button on a photo in the bean form (its own photos and the
    ones taken just for the label read): a box with draggable corners over
    the photo, then Done.
  - Done in the browser on a canvas, before the photo is shrunk to 1024 px
    and sent (`lib/photoResize.ts`), so the server stays as it is for new
    photos.
  - A saved photo, cropped later, is uploaded again as a new file in the
    same place (the old one deleted), so its cache entry changes.
- **Size:** S–M
- **Depends on:** nothing (bean photos are built).
- **Open questions:**
  - Rotate too (a photo that came out sideways), or only crop?
  - A small library (e.g. Cropper.js) or our own box? A library is quicker
    and handles pinch-zoom on a phone; our own keeps the bundle small.
  - Fixed shapes (square for the cover), or free?
  - Crop a saved photo at all, or only before it's added?

---

## C. Brewing & logging

Recording a brew: what's measured, and how fast it is to log.

### 4. Grind settings for multi-ring grinders

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

### 5. Change the brew window for any brew on the brew page

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

### 6. Repeat brews: bean and recipe as choices

- **Status:** idea
- **Why:** **Repeat** always copies the bean and what → brewer → recipe;
  only the rest is optional (`REPEAT_OPTIONS` in
  `frontend/src/lib/repeatBrew.ts`). To repeat a brew with the bag you just
  opened, or the same bean on another recipe, you repeat it and then change
  them by hand.
- **Approach:**
  - Add `bean` and `recipe` to the Repeat brews options (`RepeatKeep`,
    `REPEAT_KEEPS`, `REPEAT_OPTIONS`, `applyRepeat`), on by default so
    nothing changes for anyone who doesn't touch them.
  - **Off:** setup fills that choice as it would without a repeat (what
    Settings → Brew setup remembers, or empty to pick).
  - With bean on, the "next bag of the same coffee" fallback stays.
  - Backend `DEFAULT_PREFERENCES` and the preferences validator;
    `docs/api/auth.md` §1 repeatKeeps. People who already saved their
    repeat choices need `bean` and `recipe` added to them (a data
    migration), or a repeat stops copying them.
- **Size:** S
- **Depends on:** nothing (remembering the last bean and recipe is built).
- **Open questions:**
  - Does it make sense at all? Set aside on 2026-10-27, when remembering
    the bean and recipe was built: a repeat that doesn't copy the bean or
    recipe may not be a repeat any more.
  - With recipe off, does the brewer stay (and setup picks its last
    recipe), or do "what" and the brewer become choices too?
  - With both off, is it still a repeat, or only "copy the settings"?

### 7. What went wrong: offered by methods and brewers

- **Status:** idea
- **Why:** a brew problem belongs to one method, or to every method
  (`brew_problems.method_kind`), as prep tools did. Prep tools can now be
  offered for any methods and/or chosen brewers (Bar setup → Prep → Edit);
  "Paper taste" fits filter brewers and the OXO, not a moka pot.
- **Approach:**
  - The same model as prep tools: `brew_problems.method_kinds` (JSON list)
    plus a `brew_problem_brewers` join table; a migration turns each
    `method_kind` into a one-item list.
  - An edit page per problem like `PrepToolFormView.vue`, with "Every
    brew" or methods and brewers; Settings → Lists links to it.
  - `problemsFor` (`lib/prepTools.ts`) uses `offeredFor`, as `toolsFor`
    does; the log ref drops `methodKind`.
  - Backups: a new `BACKUP_VERSION` with an upgrade, the join table after
    brewers, and the list export brings the brewers along.
- **Size:** S–M (prep tools are the pattern).
- **Depends on:** nothing.
- **Open questions:** move brew problems from Settings → Lists to Bar setup,
  next to the prep list?

## D. Recipes

Building recipes: their steps, timings and target window.

### 8. Prep steps that don't start the timer

- **Status:** parked. Built on branch `prep-steps` (commit `dfd67db`, not
  merged) and set aside for ticking the prep tools on brew setup instead
  (roadmap: Prep on brew setup).
- **Why:** rinsing the filter, preheating or warming the cup come before the
  brew. Written as steps, they start the timer and push every later step.
- **What the branch has:** a `prep` step type for every method (a label and
  an optional countdown, always before the brew steps, no migration); a
  **Before you start** card on setup with a countdown for timed ones that
  doesn't start the timer; planned times and the window leave them out;
  `step_end` marks shifted past them (`afterPrep`) so they keep the recipe's
  step order; the AI gets them with the other steps.
- **Size:** S to finish (rebase on `dev`, which has the step timings now).
- **Depends on:** nothing.
- **Open questions:**
  - Is it needed now that setup has the prep checklist and recipes have
    default prep? A countdown (preheat 2:00) is the one thing the tools
    can't do.

### 9. Target finish window vs. the steps

- **Status:** idea
- **Why:** the target finish window and the steps are typed separately and
  nothing keeps them in step. The line under the steps shows both and turns
  the warning colour when they disagree, and `recipeWarnings` warns at the
  top of the form when the window ends before the steps do, but nothing
  fixes it. A recipe can say 3:00–3:30 while its steps add up to 4:10; the
  timer then marks every brew as slow, and the AI sees a target the recipe
  can't reach.
- **Approach:** decide which way round it works, then:
  - Fill the window from the steps (planned end, plus or minus a
    tolerance) until it's edited, with "Use the steps' time" to go back.
  - Or move the window below the step list, by the summary line (built).
  - Offer a one-tap "Fit the window to the steps" next to the summary line
    when it's outside, and fold the top-of-form warning into it. Softer
    wording when the end is approximate (tap or first-drop steps).
  - The server keeps not enforcing it (`docs/api/recipes.md`: "clients
    warn instead").
- **Size:** S–M
- **Depends on:** nothing (the summary line under the steps is built: "Steps
  end at 3:15 · Target finish 3:00–3:30", warning-coloured when outside);
  pairs with 5 (a window per brew).
- **Open questions:**
  - Which leads: the steps (window derived) or the window (steps checked
    against it)?
  - Is a window starting well before the steps end also worth a warning?
  - Should saving with a mismatch ask to confirm, or only warn?
  - Same for espresso's total shot time?

---

## E. AI suggestions

What the analysis worker sends to the LLM and what comes back.

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

### 11. Review and test the espresso dose and shot weight suggestions

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

---

## F. Insights

### 12. Save insights for the AI

- **Status:** idea
- **Why:** the Insights page shows patterns (this bean rates higher past
  two weeks of rest; ratings drop above 95 °C on this grinder), but they
  vanish when the page closes. Nothing carries them into the AI analysis
  or suggestions, which work from the brew and its brew history
  (`docs/api/llm-contract.md` §9), not from patterns across the workspace.
- **Approach:** to work out; a starting sketch:
  - A **Save** button on a chart card (and on an Explore view) that stores
    what it showed: the tab or Explore picks, the filters, the figures
    (r and n, the group averages), and a note from the person ("rest
    this bean 14+ days").
  - A list of saved insights to look back on, edit the note, or remove
    one; maybe under Insights as its own tab.
  - The AI sees the saved ones that apply to the brew it's analyzing (same
    bean, roaster, grinder, recipe or method), as a new switchable detail
    under Settings → AI (CLAUDE.md rule 9).
  - The figures are a snapshot; re-running the same view later could show
    whether the pattern still holds.
- **Size:** M
- **Depends on:** nothing (Insights is built).
- **Open questions:**
  - Save the snapshot, the view (filters + picks, re-computed each time),
    or both?
  - Per person or for the whole workspace? Who can delete one?
  - Which saved insights reach the AI, and how many before the prompt gets
    long? Does the AI get the figures, the note, or both?
  - Should the AI be able to suggest insights itself from the stats rows
    (a "what stands out?" request), saved only when the person keeps one?
  - Does it go in backups (CLAUDE.md rule 8)? It's a new table, so yes or
    a deliberate no.

---

## G. Bar & menu

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
    maybe a logo (uploaded and resized like bean photos, `backend/src/photos.ts`).
  - **Sizes:** prices per serving size once drinks have more than one size.
- **Size:** S–M (branding without a logo is S).
- **Depends on:** nothing; a logo can reuse the bean photos' storage.
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

## H. Home roasting

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
    The weight loss fills in the roasted bean's `roastWeightLossPercent`
    (built: roadmap, Roast weight loss).
  - **Resting stock:** each roast creates a `bean` (roaster = "home", the
    roast date, the detailed roast level from roadmap phase 5) marked as resting until
    a set day, then ready.
  - **Reminders** when a roast has finished resting or green stock is low,
    through the notification channels (roadmap: rate later).
  - Ratings for brews of a roasted bean link back to its roast, so roasts can
    be compared.
- **Size:** L (several branches: green stock and roast log, then resting and
  reminders, then roast comparison).
- **Depends on:** nothing (bean photos are built, for roast photos).
- **Open questions:**
  - Its own section, or a part of Beans?
  - Import roast curves (Artisan `.alog`), or only link to them?
  - Rest time per roast, or a default by roast type (filter vs. espresso)?

---

## I. Accounts

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

### 18. Email verification

- **Status:** idea
- **Why:** anyone can register any address today, and nothing checks it's
  theirs. That's why server admin is granted on the server rather than by
  email, and it limits what an email can be trusted for: password reset
  (item 17), inviting a member by email, or notifications by email.
- **Approach:**
  - On registering (and on any later email change), send a link with a
    short-lived, single-use token; the account is marked verified when it's
    opened. Unverified accounts can sign in but see a "check your email"
    banner with a resend button.
  - Outgoing mail through SMTP settings in `.env` (host, port, user,
    password, from); without them, verification is off and the app says so.
  - Optionally `REQUIRE_VERIFIED_EMAIL=true` to block an unverified account
    from workspaces until it's verified.
  - Shares the mail and token pieces with password reset (item 17).
- **Size:** M (mail is new to the stack).
- **Depends on:** nothing; pairs with 17.
- **Open questions:**
  - Block unverified accounts, or only remind them?
  - What happens to accounts that existed before verification (treat as
    verified, or ask them once)?
  - Rate limits on resending, and how long a link stays valid.

---

## J. Deployment & the app

How the app is served and installed.

### 19. Serve the app as an installable PWA

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

