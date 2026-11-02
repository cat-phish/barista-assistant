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
- A. Settings & configuration: 1–3
- B. Brewing & logging: 4–8
- C. Recipes: 9–10
- D. AI suggestions: 11–14
- E. Insights: 15–18
- F. Bar & menu: 19–21
- G. Home roasting: 22–31
- H. Accounts: 32–33
- I. Deployment & the app: 34–36
- J. Backups: 37

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
  - Ratings: how its scale maps to our 0.5–5 in half steps (and the drink
    rating).
  - Grind settings that are text rather than a dial number.
  - Photos: bring a bean's photos along (they're built, `bean-photos.md` §4c)?
  - Run it once (a migration into a fresh workspace), or again later
    without duplicating what came in before?

### 2. Mass editor for database entries

- **Status:** idea
- **Why:** changing many entries means opening each one's edit page: fixing
  a roaster's spelling across a dozen beans, filling in a process that was
  left blank, or correcting a run of brews logged with the wrong grinder.
- **Approach:**
  - A table view under Settings → Data: pick a kind of entry (beans, brews,
    recipes, equipment…), filter it, and edit cells in place.
  - Select several rows and set one field on all of them.
  - Review what will change, then save it all in one transaction, through
    the same validation as the normal routes.
- **Size:** L
- **Depends on:** nothing.
- **Open questions:**
  - Which entries come first, and which fields stay out (computed ones,
    or a brew's timer marks)?
  - Only owners, or anyone who can edit those entries?
  - Undo: is the review step enough, or should a save be reversible?
  - Should a big edit confirm with the "I understand" checkbox (CLAUDE.md
    rule 7)?
  - Does it need to work on a phone, or is it a desktop tool?
  - Should editing a brew's values stay possible when analyses were made
    from the old ones?

### 3. Review which settings belong to the workspace and which to the person

- **Status:** idea
- **Why:** settings grew feature by feature, some in `users.preferences`
  and some in the workspace's settings, so where one lives isn't always
  where it should. One person's choice can apply to everyone, or a choice a
  bar should share has to be made by each member. For example, the AI prompt
  is per person (`users.ai_prompt`) while what the AI sees is per workspace.
- **Approach:**
  - List every setting: where it's stored, who it affects, who can change it.
  - Decide each one: person, workspace, or a workspace default a person can
    override.
  - Move the ones that are wrong, with a data migration, and make Settings
    say which kind each one is.
- **Size:** S to review; each move S–M.
- **Depends on:** nothing; do it before 37, since where a setting lives
  decides how it's backed up, and the audit is the same work.
- **Open questions:**
  - Is "workspace default, person overrides" worth having, or is it one or
    the other?
  - When a person's setting moves to the workspace, whose value wins?

---

## B. Brewing & logging

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

### 8. Flavor wheel: intensity, and flavors in Insights

- **Status:** idea
- **Why:** the flavor wheel (roadmap, "Flavor wheel") records a flavor as
  just picked. "A hint of lemon" and "lemon everywhere" look the same, to
  you and to the AI. And the picks are counted nowhere yet, though that
  was half the reason to have a fixed vocabulary.
- **Approach:**
  - Review after living with the wheel for a while: is intensity missed?
    If so, an optional intensity per pick (faint / clear / strong): a
    nullable column on `brew_log_flavors`, `flavors` as
    `[{ key, intensity }]` (or keys staying valid on their own, so old
    clients and backups still work), tapping a picked chip to cycle it, and
    the AI reading "Lemon (strong)".
  - Insights: flavors per bean (which ones keep coming up), compared with
    the roaster's `flavorProfile`; flavors against rating.
- **Size:** S–M each.
- **Depends on:** nothing.
- **Open questions:**
  - Intensity: worth the extra tap, or does it slow logging down for
    little gain? Decide from use.
  - Insights: a chart of its own, or a filter on the existing brew charts
    (Explore) like problems?

## C. Recipes

Building recipes: their steps, timings and target window.

### 9. Prep steps that don't start the timer

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

### 10. Target finish window vs. the steps

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

## D. AI suggestions

What the analysis worker sends to the LLM and what comes back.

### 11. Build bar items from plain text (AI)

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

### 12. Review and test the espresso dose and shot weight suggestions

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

### 13. Review how step temps reach the brew log and the AI

- **Status:** idea
- **Why:** recipes can set a temperature per step, and a brew can now move
  them all (`stepTempsFollowBrew`), but the log and the analysis were built
  around one water temperature, so the AI can misread a stepped brew.
- **What we found:**
  - The brew log stores only `actualTempC`, plus `stepTempShiftC`.
  - The worker reads step temps from the live recipe, and `scaledToBrew`
    doesn't apply `stepTempShiftC`, so on a shifted brew the AI sees the
    recipe's step temps next to the brew's real water temp.
  - `shared/src/aiPrompt.ts` never says how `actualTempC`, the recipe's
    target and the step temps relate, or what `suggestedTempDelta` and
    Suggest's `tempC` mean for the steps.
  - Editing a recipe changes what old brews appear to have used, for every
    recipe field, not only temps.
- **Open questions:**
  - Apply the shift in `scaledToBrew` (`shiftStepTemps` is already in
    `@barista/shared/brew`) and add a prompt section explaining step temps?
  - Should a brew keep a copy of its recipe, so old brews stay as brewed?

### 14. Review how flavor wheel inputs reach the AI

- **Status:** idea
- **Why:** the wheel was built to give the AI a fixed vocabulary, but
  nobody has checked that the picks change its advice for the better, or
  how it weighs them against the tasting notes and the rating.
- **What we found:**
  - `flavorsFor` (`worker/src/context.ts`) sends each pick as text with its
    place on the wheel, e.g. `"Blueberry (Fruity › Berry)"`, in wheel order.
    Analysis, Suggest parameters and the bean review all use it.
  - The prompt's `flavors` section (`docs/api/llm-contract.md` §9) says how
    to read them: go by meaning rather than group names, read them with the
    tasting notes, and compare them with `flavorProfile`.
  - Flavors are always sent (`worker/tests/aiDetails.test.ts`), with no
    switch under Settings → AI, while the roaster's `flavorProfile` has one.
  - A pick carries no intensity, so one faint note reads the same as a
    dominant one (see 8).
- **Approach:** run the eval on brews with and without picks
  (`docs/api/llm-contract.md` §9, "Evaluating changes"), compare the advice,
  and adjust the prompt if it reads worse (bump `PROMPT_VERSION`).
- **Size:** S
- **Depends on:** a good number of rated brews with flavors picked.
- **Open questions:**
  - Does the place on the wheel help, or would the label alone do?
  - How does it cope with a workspace's own wheel, whose groups may mean
    something else?
  - Should the picks be switchable under Settings → AI (CLAUDE.md rule 9)?
  - Should the picks be compared with `flavorProfile` more directly, as a
    "how close to the roaster's notes" reading?

---

## E. Insights

### 15. Save insights for the AI

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

### 16. Cold brew batches skew the caffeine and volume figures

- **Status:** idea
- **Why:** a brew log is one batch, and it doesn't say how much of it was
  drunk or when. A big cold brew counts its whole dose on the day it's
  logged, so one 1 L batch shows as a huge day and a huge "brew", and pulls
  up Caffeine Total, Caffeine/Brew and Caffeine/Day (`docs/api/stats.md` §11,
  "How the client counts"). Volume drunk has the same problem, and any
  batch brewed to share or kept for later does too.
- **Approach:** to review; a starting sketch:
  - Look at how far real batches move the figures before picking a fix.
  - Record servings or the portion drunk on a batch, and count each brew's
    share of its dose and volume.
  - Or spread a batch over the days it was drunk.
  - Or leave batch styles out of the per-brew average, or say on the tile
    that batches count in full.
- **Size:** S to review and label; M if it records what was drunk.
- **Depends on:** nothing; 19 (a finished cold brew as stock, each glass
  served taken from it) could answer it.
- **Open questions:**
  - Is a rough split (servings per batch) enough, or does each glass need
    logging?
  - What counts as a batch: cold styles only, or any brew over a set dose?
  - Whose intake is it when a batch is shared with other people?

### 17. AI chat in Insights

- **Status:** in progress (spec: `docs/api/chat.md` §12)
- **Why:** the AI only answers through fixed jobs (analysis, Suggest
  parameters, bean review). There's no way to ask it something of your own,
  like why two brews tasted so different or what to try next with a bean,
  or to show it a photo of a puck or a roaster's bag.
- **Approach:** a **Chat** tab in Insights, replies appearing as they're
  written. The worker holds the AI keys, so it calls the model and writes to
  a Redis stream, and the backend passes that to the browser as server-sent
  events. Branches, in order:
  1. Text chat: tables, routes, the streaming path, the tab.
  2. **Attach** brew logs, recipes and beans from a picker. Attachments go
     through the same summaries as the analysis (`worker/src/context.ts`),
     and what's hidden under Settings → AI stays hidden (CLAUDE.md rule 9).
     Rebuilt on every turn, so a later hide or delete applies.
  3. **Photos:** uploaded into the chat, resized as bean photos are
     (`backend/src/photos.ts`) and kept with it.
  4. **Keeping and purging:** limits on history size and age, set for the
     server and by each person (a person's can't exceed the server's, and
     either can be unlimited); purging chat data; a limit on messages.
     **Turning chat off:** for a whole workspace, and for one member by the
     workspace's owner.
  5. **Export and import** of a person's chats.
- **Size:** L
- **Depends on:** nothing (choosing a model is built: photos need one that can
  see them). Pairs with 15: a useful answer could be saved
  as an insight.
- **Decided:**
  - Chats are kept and private to the person. Not in workspace backups (a
    backup would hand them to whoever downloads it): they have their own
    export and import.
  - Read-only for now; proposals are item 18.
  - The AI sees only what's attached; it can't look things up itself.
  - Photos stay with their chat and go when it does.
  - Max size is what a person's chats take on disk, messages and photos
    together, entered in KB, MB or GB. The server's default is 1 GB; going
    over removes that person's oldest chats first.
  - Purging chat data takes the "I understand" checkbox (CLAUDE.md rule 7).
    Deleting one chat doesn't, and has no confirmation.
  - Leaving or being removed from a workspace deletes your chats there; the
    dialogs say so.

### 18. AI chat proposals

- **Status:** idea
- **Why:** the chat in 17 is read-only, so a recipe or a parameter change it
  suggests has to be typed in by hand.
- **Approach:** a reply can carry a proposal (a new recipe, a parameter
  change) shown as a card the person accepts or dismisses; accepting goes
  through the normal routes. Nothing changes without that.
- **Size:** M
- **Depends on:** 17.
- **Open questions:**
  - Which changes can it propose first?
  - How does a structured proposal fit into a streamed reply, on both
    providers?

---

## F. Bar & menu

### 19. Ingredient prep and stock

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

### 20. Public menu: branding and sizes

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

### 21. Drink categories: what else they could do

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

Roast mode, green stock, the roast log and resting are built (roadmap:
Home roasting). Paused here; these are what's next.

**Open questions (home roasting):**
- Should deleting a roast get the "I understand" checkbox (CLAUDE.md
  rule 7)? It uses the plain confirm dialog today.
- Should other members be able to get a roast's rest reminder, not only
  whoever logged it?
- Should freezing a home-roasted bean pause or extend its rest?

### 22. Live roast timer

- **Status:** planned (branch `roast-timer`)
- **Why:** roast times are typed in after the roast; a timer running while
  roasting is easier and more exact.
- **Approach:** a live clock on the Roast form with **Charge**, **First
  crack** and **Drop** marks that fill in `firstCrackSec` and `totalSec`,
  reusing the brew timer's clock and marks (`docs/timer_architecture.md`).
- **Size:** M
- **Depends on:** nothing.
- **Open questions:**
  - Note a temperature at each mark?
  - Keep the screen awake while it runs?

### 23. Roast insights

- **Status:** idea
- **Why:** Insights covers brewing only; a home roaster wants to see what
  their roasts cost, how consistent they are, and how long to rest them.
- **Approach:** a Roasting area in Insights (roast mode), on the existing
  charts and filters (`frontend/src/views/stats`, `docs/api/stats.md`):
  - roasts per month, green used, and spend;
  - weight loss and development % by green coffee, roast level and machine;
  - cost per roasted 100 g;
  - **rest sweet spot:** brew ratings by days off roast for home roasts,
    suggesting rest days per roast type or green coffee.
- **Size:** M
- **Depends on:** nothing; 24 and 28 make it richer.
- **Open questions:** should the rest sweet spot offer to change the
  workspace's default rest days?

### 24. Compare roasts

- **Status:** idea
- **Why:** with several batches of one green coffee, it's hard to see which
  roast tasted best and what was different about it.
- **Approach:** the batches of a green coffee side by side: levels, times,
  temperatures, weight loss, development, and how each one's brews rated.
- **Size:** M
- **Depends on:** nothing; can share a branch with 23.

### 25. Roast again, and roast plans

- **Status:** idea
- **Why:** a good roast is worth repeating, and today the form starts empty.
- **Approach:**
  - **Roast again** on a roast's page copies its green coffee, machine,
    weights, temperatures and times as targets, like Repeat brew;
  - optionally a **plan** list: roasts to do next (green coffee, weight,
    for filter or espresso), ticked off when logged.
- **Size:** S–M (plans are the M)
- **Depends on:** nothing.

### 26. Running low on roasted coffee

- **Status:** idea
- **Why:** the low notice covers green coffee; running out of roasted coffee
  is what actually interrupts brewing.
- **Approach:** when a home-roasted bean (or all rested roasts together)
  drops below a threshold, a notice through the notification channels
  suggesting the next roast, like the `green-low` job
  (`docs/api/notifications.md` §1b).
- **Size:** S
- **Depends on:** nothing; pairs with 25's plans.
- **Open questions:** a threshold per workspace, or per green coffee?

### 27. Green coffee details and restocks

- **Status:** idea
- **Why:** buying the same coffee again means editing the weight left by
  hand, which loses the purchase history and price changes.
- **Approach:**
  - **restocks** as dated entries (weight, price) instead of editing
    `weightLeftGrams`, giving purchase history and cost per kg over time;
  - optional **moisture %** and **density**;
  - mark a green coffee as a **sample**.
- **Size:** M
- **Depends on:** nothing.

### 28. Cupping notes per roast

- **Status:** idea
- **Why:** brew ratings mix the roast with the brewing; cupping judges the
  roast itself.
- **Approach:** a short cupping form on a roast: aroma, sweetness, acidity,
  body, a score, and roast defects (scorching, tipping, baked,
  underdeveloped). Shown on the roast's page; feeds 23 and 24.
- **Size:** S–M
- **Depends on:** nothing.

### 29. Roast details for the AI

- **Status:** idea
- **Why:** for a home roast, how it was roasted explains a lot about how it
  brews.
- **Approach:** add the roast's level, development time, weight loss and
  days rested to the analysis context for brews of home-roasted beans.
  CLAUDE.md rule 9: decide always sent or switchable, and update
  `docs/api/llm-contract.md` §9.
- **Size:** S
- **Depends on:** nothing.

### 30. Roast curves

- **Status:** idea
- **Why:** roasting software (Artisan) records the whole curve; the log only
  keeps a few numbers.
- **Approach:** attach an Artisan `.alog` file to a roast and show bean
  temperature and rate of rise on its page; fill in the roast's times and
  temperatures from it.
- **Size:** L
- **Depends on:** nothing.

### 31. Roasting machine upkeep

- **Status:** idea
- **Why:** roasters need regular chaff and cleaning, easy to forget.
- **Approach:** batches since the last cleaning on each machine, a
  "Cleaned" button, and a reminder after a set number of roasts.
- **Size:** S
- **Depends on:** nothing.

---

## H. Accounts

### 32. Account management and password reset

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

### 33. Email verification

- **Status:** idea
- **Why:** anyone can register any address today, and nothing checks it's
  theirs. That's why server admin is granted on the server rather than by
  email, and it limits what an email can be trusted for: password reset
  (item 32), inviting a member by email, or notifications by email.
- **Approach:**
  - On registering (and on any later email change), send a link with a
    short-lived, single-use token; the account is marked verified when it's
    opened. Unverified accounts can sign in but see a "check your email"
    banner with a resend button.
  - Outgoing mail through SMTP settings in `.env` (host, port, user,
    password, from); without them, verification is off and the app says so.
  - Optionally `REQUIRE_VERIFIED_EMAIL=true` to block an unverified account
    from workspaces until it's verified.
  - Shares the mail and token pieces with password reset (item 32).
- **Size:** M (mail is new to the stack).
- **Depends on:** nothing; pairs with 32.
- **Open questions:**
  - Block unverified accounts, or only remind them?
  - What happens to accounts that existed before verification (treat as
    verified, or ask them once)?
  - Rate limits on resending, and how long a link stays valid.

---

## I. Deployment & the app

How the app is served and installed.

### 34. Test the installed app on phones

- **Status:** idea
- **Why:** the PWA is now served as a build over HTTPS (roadmap:
  "Installable PWA, served over HTTPS"), but only checked with curl. Nobody
  has installed it on a phone yet.
- **Approach:** on the server it will run on, on an Android phone and an
  iPhone:
  - trust the CA from `http://<address>:42070/ca.crt` (README steps; fix them
    where they're wrong);
  - install it, and check the name, icon, standalone window and
    portrait lock;
  - **offline:** with the server stopped, the app shell and the public
    menu still open, and bean photos seen before still show;
  - **links:** a rate-later reminder's link opens the installed app
    (Android) rather than the browser. If Android only made a shortcut
    (a self-trusted CA can stop it building a full app), note it: links
    then open in the browser;
  - **updates:** rebuild mid-brew; the brew isn't reloaded away, and the
    new version applies after Save (and after Cancel). With no brew
    running it applies on its own, also in an app left open (hourly
    check);
  - the session survives closing and reopening the app.
- **Size:** S
- **Depends on:** the app running on the home server.
- **Open questions:** none.

### 35. Web Push from the installed app

- **Status:** idea
- **Why:** reminders (rate later) go out through ntfy, Gotify and the
  others, which each need their own app. The installed PWA could get them
  itself, as one more channel.
- **Approach:** a Web Push channel in Settings → Notifications: the app
  subscribes (VAPID keys from the server's secrets), the backend stores the
  subscription, and the worker sends to it like the other channels. The
  service worker shows the notification and opens the brew when tapped.
- **Size:** M
- **Depends on:** nothing (the app is served as an installable PWA now).
- **Open questions:**
  - iOS only delivers Web Push to an app added to the Home Screen (16.4+):
    say so on the channel, or hide it in the browser?
  - Several devices per person: one subscription each, all notified?

### 36. Protect the testing branch on GitHub

- **Status:** idea
- **Why:** the server pulls whatever is pushed to `testing`, and a push can
  carry migrations, so a stray force-push or a deleted branch could put the
  wrong build on it. Requiring PRs would break fast-forwarding from `dev`
  (a merge commit would exist only on `testing`) and slow down testing a
  build.
- **What:** a GitHub rule on `testing` that blocks force-pushes and deletion,
  with no PR requirement. Pushes stay as they are.

---

## J. Backups

What a backup keeps, so moving to a new server loses nothing.

### 37. Back up every setting

- **Status:** idea
- **Why:** a workspace backup (`docs/api/backup.md` §2b) leaves out what
  belongs to a person, so restoring on a new server quietly resets it.
  Notification defaults were noticed missing, and there's more. Workspace
  settings are already in it.
- **Approach:** first audit every setting against the backup, then close the
  gaps. Known to be left out today:
  - **Preferences** (`users.preferences`): units, theme, reminder settings
    (rate-later, steep, rest, low green stock), repeat and remember choices,
    start delays.
  - **Notification channels** (`notification_channels`).
  - **Their own AI prompt** (`users.ai_prompt`).
  - **Added Insights charts and tab layouts** (`insight_charts` and the
    layout beside it on the member).
  - **Server settings** (`server_settings`, such as the backup schedule):
    server-wide, so maybe only in a database dump.
  - A way to save them could be a personal settings section in the backup,
    applied to whoever restores it, or a separate account export.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:**
  - Whose settings go in a shared workspace's backup: only the person
    backing up, or every member's?
  - Do restored settings overwrite the restorer's own, or does the app ask?
  - Channels hold bot tokens and webhook URLs: include them, encrypt them, or
    leave them out and restore everything else?
  - Should a test fail when a new setting isn't classified, like the table
    check (`NOT_BACKED_UP`, CLAUDE.md rule 8)?
