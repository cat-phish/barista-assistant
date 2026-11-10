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
- B. Brewing & logging: 5–8
- C. Recipes: none
- D. AI suggestions: 9–12
- E. Insights: 13–18
- F. Bar & menu: 19–24
- G. Home roasting: 25–34
- H. Accounts: 35–36
- I. Deployment & the app: 37–38
- J. Backups: 39

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
- **Depends on:** nothing; do it before 39, since where a setting lives
  decides how it's backed up, and the audit is the same work.
- **Open questions:**
  - Is "workspace default, person overrides" worth having, or is it one or
    the other?
  - When a person's setting moves to the workspace, whose value wins?

### 4. Starter data for a new workspace

- **Status:** idea
- **Why:** a new workspace starts nearly empty: the default brewers, prep
  tools and brew problems, and nothing else. Before the first brew you set
  up recipes, equipment, water and notes from scratch, and an empty app
  doesn't show what each page is for.
- **Approach:**
  - When a workspace is first set up, offer to install starter data:
    recipes (a few classic pour-over, espresso and Aeropress ones), more
    brewers and grinders, water profiles, notes (with example calculators,
    e.g. a descaling or water recipe), and drink categories or menu
    entries. Never brew logs, beans or anything with history.
  - Pick what to install by kind (checkboxes), with everything optional.
  - Ship it as a bundled file in the list export format and install it
    through the list import (`backend/src/listImport.ts`,
    `docs/api/backup.md`), so it gets the same validation and matching
    and there's no second seeding path to keep in step.
- **Size:** M (mostly choosing and writing the content).
- **Depends on:** nothing.
- **Open questions:**
  - Offered only right after creating a workspace, or also later
    (Settings → Data → "Install starter data")? Later means matching
    against what's already there, which the import already does.
  - Mark installed entries as examples (to find and remove them in one
    go), or are they ordinary entries from the start?
  - Not offered when restoring a backup as a new workspace?
  - One starter set, or a few (filter-only, espresso bar, café)?
  - Who writes and checks the recipes and their numbers?

---

## B. Brewing & logging

Recording a brew: what's measured, and how fast it is to log.

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

### 6. Usual grind adjustment: per method, or learned

- **Status:** idea
- **Why:** each grinder now has one typed **Usual adjustment** (roadmap:
  usual grind adjustment per grinder) that the AI sizes its grind moves by.
  One number may not fit every brew: cold brew or espresso on the same
  grinder can call for different moves, and people may not know their habit
  well enough to type it.
- **Approach:**
  - Per method: an optional override per grinder and brewer kind (e.g.
    coarser moves for cold brew), falling back to the grinder's number.
  - Learned: show how far the setting usually moves between brews of one
    bean on that grinder, as a hint next to the field or sent to the AI
    when none is typed.
- **Size:** S–M
- **Depends on:** nothing; pairs with 5 (a ring-format grinder's usual
  adjustment would be in its own clicks).
- **Open questions:**
  - Is the per-grinder number enough in practice? Assess after using it.
  - Learned: which brews count (same bean and recipe only), and how many
    before it's trusted?

### 7. Flavor wheel: intensity, and flavors in Insights

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

### 8. Water adjustment calculator

- **Status:** idea
- **Why:** water profiles record what's in a water (Bar setup → Water,
  `docs/api/water-profiles.md` §3c), but not how to make it. Building brew
  water from distilled or RO, or adjusting tap water, means working out the
  grams of each mineral or concentrate by hand or in another app.
- **Approach:** to work out; a starting sketch:
  - **First, try it without building anything:** set up the water recipes
    I use as calculators in Notes, and use them for a while to see whether
    a dedicated calculator is needed at all. Build this only if the
    calculators fall short (targets, several minerals, saving a profile).
  - Pick a target (a saved water profile, or hardness and alkalinity) and a
    base water (distilled, or a saved profile for tap), and get how much of
    each mineral or concentrate to add for a batch size (epsom salt, baking
    soda, calcium chloride, potassium bicarbonate, or concentrates).
  - Save the result as a new water profile, with the recipe in its notes.
  - Plain arithmetic in the client; no AI.
- **Size:** M
- **Depends on:** nothing (water profiles are built).
- **Open questions:**
  - Making water from scratch, blending (tap with distilled 1:3), or both?
  - Which minerals and concentrates to offer, and can people add their own
    (ppm added per gram per litre)?
  - Where it lives: Bar setup → Water, or as a note's calculator (notes
    have calculators with inputs and formulas, see the roadmap)? A note
    can already hold a fixed recipe; the open part is targets and minerals.

## C. Recipes

Building recipes: their steps, timings, target window and yield.

Nothing planned right now.

---

## D. AI suggestions

What the analysis worker sends to the LLM and what comes back.

### 9. Build bar items from plain text (AI)

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

### 10. Review and test the espresso dose and shot weight suggestions

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

### 11. Review how flavor wheel inputs reach the AI

- **Status:** on hold until the real brews are imported (see Depends on);
  the eval can already run with and without picks
- **Why:** the wheel was built to give the AI a fixed vocabulary, but
  nobody has checked that the picks change its advice for the better, or
  how it weighs them against the tasting notes and the rating.
- **What we found** (checked 2026-11-08):
  - `flavorsFor` (`worker/src/context.ts`) sends each pick as text with its
    place on the workspace's own wheel (or the built-in one), e.g.
    `"Blueberry (Fruity › Berry)"`, in wheel order. Analysis, Suggest
    parameters (for each brew before) and the bean review all use it.
  - The prompt's `flavors` section (`docs/api/llm-contract.md` §9) goes
    further than "read them with the tasting notes": the wheel can be the
    workspace's own, so go by meaning, not group names; a broader pick is
    less specific, not weaker; sour, fermented or green picks often mean
    under-extraction, harsh, ashy or bitter ones over-extraction or the
    roast, off flavors (papery, musty) the beans or filter; compare with
    `flavorProfile`. It's only sent when a brew has picks.
  - Flavors are always sent (`worker/tests/aiDetails.test.ts`), with no
    switch under Settings → AI, while the roaster's `flavorProfile` has one.
  - A pick carries no intensity, so one faint note reads the same as a
    dominant one (see 7).
  - As of 2026-11-08 only one rated brew has picks, so the eval can't say
    much yet. It shows two things to check: a pick whose key left the wheel
    keeps its old saved place, so one brew sent `"Nutty (Nutty/Cocoa)"`
    beside `"Walnut (Nutty & cocoa › Nutty)"` (same group, two names); and
    broad picks sit beside narrower ones on the same branch (`Stone fruit`
    with `Apricot` and `Cherry`), which the prompt reads as "less
    specific", not as a second note.
- **Approach:** with the eval (`docs/api/llm-contract.md` §9, "Evaluating
  changes"): `snapshot --with-flavors`, then `run --label flav` against
  `run --label noflav --without flavors` (and `--without places` for labels
  only), each also with `--suggest`; `compare` the pairs and adjust the
  prompt if picks make the advice worse (bump `PROMPT_VERSION`).
- **Size:** S
- **Depends on:** a good number of rated brews with flavors picked
  (`snapshot --with-flavors` shows how many; one on 2026-11-08). The real
  ones are on the hosted instance used day to day, so first import those
  brews and ratings into this database, then run the eval.
- **Open questions:**
  - Does the place on the wheel help, or would the label alone do?
    (`--without places`.)
  - A workspace's own wheel, whose groups may mean something else: the
    prompt already says to go by meaning, not group names; check it holds
    on a custom wheel.
  - Should the picks be switchable under Settings → AI (CLAUDE.md rule 9)?
  - Should the picks be compared with `flavorProfile` more directly, as a
    "how close to the roaster's notes" reading?

### 12. Test whether the usual grind adjustment helps

- **Status:** idea
- **Why:** grinders now have a **Usual adjustment** (roadmap: usual grind
  adjustment per grinder) and a `usualAdjustment` prompt section that sizes
  grind moves by it. Nobody has checked that the advice gets better: that
  the AI's grind moves (in `nextStep`, the reasoning and Suggest's
  `grindSetting`) land near the usual amount for a clear miss, go smaller
  when a brew is nearly there, and don't just repeat the number.
- **Approach:** with the eval (`docs/api/llm-contract.md` §9, "Evaluating
  changes"): add `--without usualAdjustment` to `worker/src/eval.ts` (it
  only knows `flavors` and `places` today), set the usual adjustment on the
  grinders the real brews used, then `run --label usual` against
  `run --label nousual --without usualAdjustment`, each also with
  `--suggest`, and `compare` them. Then use it on real brews for a while:
  do the suggested moves match how far you'd actually turn the dial, and
  do brews dial in sooner? Adjust the prompt section if not (bump
  `PROMPT_VERSION`).
- **Size:** S
- **Depends on:** rated brews on grinders with a usual adjustment set; like
  11, the real ones are on the hosted instance, so import them first.
- **Open questions:**
  - Does the AI still go down to one step when a brew is close, or does it
    always move the usual amount?
  - Does Suggest's `grindSetting` move by it from the last brew, or only
    the wording change?
  - The answers feed backlog 5 (per method or learned).

---

## E. Insights

### 13. Save insights for the AI

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

### 14. Cold brew batches skew the caffeine and volume figures

- **Status:** in progress
- **Why:** a brew log is one batch, and it doesn't say how much of it was
  drunk or when. A big cold brew counts its whole dose on the day it's
  logged, so one 1 L batch shows as a huge day and a huge "brew", and pulls
  up Caffeine Total, Caffeine/Brew and Caffeine/Day (`docs/api/stats.md` §11,
  "How the client counts"). Volume drunk has the same problem.
- **Measured (2026-11-09):** small so far. 2 cold brews of 49 brews (40 g
  each, 80 of 1,149 g) were about 7% of the caffeine; the average dose per
  brew went 23.5 g → 22.6 g without them. Built anyway, because servings
  are worth logging for their own sake (dilution vs. rating).
- **Done:** the servings API (branch `brew-servings`, migration 0117,
  `api/brew-servings.md` §6c): `brew_servings` and their flavors, Batch
  finished (`PUT …/batch`), `servingCount`/`pouredGrams` on a brew log, in
  backups. Any owner or barista pours from any batch; a serving is changed by
  its logger or an owner. Deleting a batch with servings will confirm with
  "I understand" (rule 7, agreed; built with the UI).
- **Done:** the batch's journal entry (branch `servings-ui`, migration
  0119): stock line, Log a serving (water pre-filled from the batch's served
  dilution, Concentrate made first on an unweighed batch), the servings with
  edit/delete, Batch finished / Reopen; "≈ … left" / "Finished" on Journal
  cards; deleting a batch with servings lists them and asks for "I
  understand". A batch can be **diluted in the jar** (`jarWaterGrams`):
  servings then pour ready to drink and share the jar (yield + water).
- **On trial:** "In the fridge" on the Brew page (`FridgeCard.vue`): open
  batches with what's left, Log a serving and Finished. Kept or dropped
  after using it for a while.
- **Done:** Finish on a long batch asks for the concentrate made, and a
  finished batch without one shows the estimate with "≈" and an Add yield
  nudge; `lib/batch.ts` has the yield, share and stock math (branch
  `batch-yield`).
- **Done:** unmeasured brews' volume in Insights and recaps is estimated
  with the brewer's grounds retention (typed, else learned from its latest
  measured brews), else the roast level's (branch `stats-brewer-retention`).
- **Approach (agreed):** a finished cold brew batch is stock, and each glass
  is logged as a serving taken from it.
  - **Which batches:** long styles only (`LONG_STYLES`: cold brew, Kyoto
    drip), once finished (not steeping).
  - **A serving:** new table `brew_servings`, child of the batch's brew
    log: who logged it, when, **concentrate** and **diluent** amounts (the
    ratio is worked out from them), diluted with, rating, tasting notes and
    flavor-wheel picks.
  - **Stock:** the batch's yield (measured, else estimated) minus its
    servings' concentrate, never below 0. **Batch finished** marks it empty
    (poured out or done); it then leaves the in-stock list.
  - **The yield matters:** a serving's share is its concentrate ÷ the larger
    of the yield and everything poured (`servingShare`, `lib/batch.ts`), so
    shares never add up past the whole batch. An unweighed yield is
    estimated (brewer's retention, else roast) and shown with "≈". Finish
    asks for the **concentrate made** (skippable), and so does the first
    serving on a batch without one.
  - **Counting:** once a batch has a serving, only its servings count, each
    with its share of the batch's dose (caffeine) and its diluted volume, on
    the day and under the person who logged it. The unlogged rest never
    counts. A batch with no servings counts in full on its brew day, as now.
  - **AI:** a batch's servings reach its analysis and the brew history, as
    a new switchable detail under Settings → AI (CLAUDE.md rule 9).
  - **Also:** backups (rule 8: a child table, in `BACKUP_TABLES`); deleting
    a batch that has servings may need the confirm dialog (rule 7: ask
    first).
  - **Branches:** servings API (schema, routes, backup, tests) → the batch's
    journal entry (stock, Log a serving, Batch finished) → Insights and
    recaps counting servings → the AI.
- **Size:** L
- **Depends on:** nothing. 19 (ingredient stock) may later share the stock
  idea.
- **Open questions:**
  - Keep the Brew page's "In the fridge" card? (on trial, see above)

### 15. Test AI chat fully in the browser

- **Status:** planned
- **Why:** AI chat is built (roadmap, "AI chat in Insights") and covered by
  unit and route tests, but it hasn't had a full pass in a real browser, on
  a desktop and a phone, against both AI providers.
- **Approach:** an extended test pass, fixing what turns up on branches off
  `dev`:
  - Messages and formatted replies (tables, lists, code, links; HTML shown
    as text), streaming, reconnecting mid-reply, Retry on a failed reply.
  - The attach picker: each tab, the Brews filters, Select all and the
    `chatMaxAttachments` limit, unticking, the folded chips, Charts under
    their own filters.
  - Photos picked, pasted and dropped; the vision model used.
  - The phone drawer and the full-screen layout.
  - Settings → AI (the attachment limit), AI chats (a person's limits and
    the server's), purging, export and import, and both on/off switches
    (the workspace's and a member's).
- **Size:** M (the testing; fixes as they come).
- **Depends on:** nothing.
- **Open questions:** none.

### 16. Review and refine parameter and recipe suggestions

- **Status:** idea (recipe step checks and guidance done, see the roadmap:
  "Checks and step guidance for AI recipe proposals")
- **Why:** the AI suggests brew values in two places: **Suggest
  parameters** on the brew page (`docs/api/analysis.md` §8b) and chat
  proposals. The chat's recipe steps are now checked and flagged; Suggest's
  values haven't been judged. The 36 local suggestions look plausible but
  samey: the next step mostly restates the values, the temperature swings
  between 89 and 93 °C, and the ratio is rarely set.
- **Approach:**
  - **Review the recipe step checks after testing them in use:** do real
    chat proposals get flagged, and are the warnings right (no false alarms
    on recipes you'd brew, nothing bad slipping through)? Does the 2026-11-b
    chat prompt hold up on the hosted instance and the other provider? Tune
    the thresholds in `@barista/shared/recipeChecks` or the prompt from what
    turns up.
  - Run the eval's Suggest mode (`run --suggest`, `docs/api/llm-contract.md`
    "Evaluating changes") on the current prompt and judge the grind steps,
    temperatures and ratios against how the brews went; tighten the Suggest
    prompt where it goes wrong and bump `PROMPT_VERSION`.
  - Chat proposals for long cold styles: the proposal schema has no steep
    hours, steep temperature or dilution, so a cold brew proposal can only
    say the steep in its text. Add them (as `recipes.md` §5 has them) if
    cold brew proposals come up.
  - Watch for replies that describe a recipe with no card: one eval run had
    4 of 8 (before the prompt asked for the block), later runs none.
- **Size:** M
- **Depends on:** nothing; pairs with 10 (espresso dose and shot weight).
- **Open questions:**
  - Should a "next brew" proposal also set the dose and water, not only
    grind, temperature and ratio?
  - Should the recipe form point out where a proposal differs from the
    saved recipe?
  - Do the step checks need tuning once real proposals with warnings show
    up (thresholds in `@barista/shared/recipeChecks`)?

### 17. Ask in chat from a chart card

- **Status:** planned
- **Why:** charts can be attached from the chat's picker (Charts tab), but
  the question usually comes up while looking at the chart itself.
- **Approach:** an **Ask in chat** button on each chart card opens the Chat
  tab with that chart attached, under the page's filters. The snapshot is the
  one the picker sends (`lib/chartHarvest.ts`, `docs/api/chat.md` §12), so
  only the hand-over is new: the Chat tab reads the chart from a store or the
  route and starts with it attached.
- **Size:** S
- **Depends on:** nothing (attaching charts is built). Shares its snapshot
  shape with 13.
- **Open questions:**
  - Should it go into the chat in use, or always start a new one?

### 18. Review weekly and monthly recaps after testing (built)

- **Status:** built (roadmap: Weekly and monthly recaps); kept here to
  review after a testing period (`docs/api/recaps.md` §11c).
- **Why:** Insights shows patterns when you go looking; nothing tells you
  how the week or month went: how much you brewed, what rated best, which
  beans were opened or finished.
- **Approach:**
  - **Review phase 1 after a testing period:** do the recap's figures match
    the other Insights tabs for the same dates? Are the right tiles there,
    and is anything missing (problems logged, grind changes, beans coming
    into their rest window)? Does the period navigation and the "Only my
    brews" switch work as expected? Is the Settings → Recaps page clear?
  - **Review the banner after a testing period:** does it show when
    expected (and not for an empty week), is it unobtrusive enough, and do
    opening, dismissing and the day limit take it away as they should?
  - **Review the notification after a testing period:** does it arrive on
    time in your time zone, once, with the right figures, and does its
    link open the right recap? Is the message worth having, or too terse?
  - **Review the AI summary after a testing period:** are the summaries
    right and worth reading (nothing invented, the "one thing to try"
    useful), is automatic mode worth its tokens, and should the prompt be
    editable under Your AI prompt? `npm run eval -w worker -- recap` reruns
    them on your recent weeks (llm-contract.md §9f).
- **Size:** M; L with the AI summary.
- **Depends on:** nothing; live periods in chat (roadmap) share its period
  context.

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
  - A finished cold brew batch as stock, each glass taken from it and
    rated, is being built under 14; ingredient stock could reuse its idea.

### 20. Drink categories: what else they could do

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

### 21. The guest menu as its own app

- **Status:** idea
- **Why:** a regular could add the bar's menu to their home screen and
  open it straight to `/menu/:slug`, with the bar's name, colour and logo
  (roadmap: public menu branding and sizes), instead of the journal app.
- **Approach:** a web app manifest per menu (name, `theme_color` from the
  accent colour, icons from the logo, `start_url` and `scope` the menu's
  address), linked from the guest page only.
- **Size:** S–M
- **Depends on:** nothing.
- **Open questions:** does the journal's own manifest and service worker
  get in the way (one origin, one scope `/`), and is it worth it before
  testing the installed app on phones (item 37)?

### 22. Menu entries without a drink or brewer

- **Status:** idea
- **Why:** a menu item is a drink, a brewer or the beans block
  (`docs/api/menu.md`, `POST /sections/:sectionId/items`), so anything not
  set up as a drink or recipe can't go on the menu: a pastry, a bag of
  beans for sale, a special not written up yet, "ask about our decaf".
- **Approach:** a fourth `itemType` (e.g. `custom`) with neither `drinkId`
  nor `brewerId`: a required name (there's no source to fall back on), and
  the description, price or sizes and available flag the others have. The
  menu builder gets "Add an item"; the guest menu shows it like a drink
  without method or ingredients.
- **Size:** S–M
- **Depends on:** nothing.
- **Open questions:**
  - A photo of its own?
  - Can it later be turned into a real drink, keeping its place and price?
  - Check backups and the list import carry the new type.

### 23. Upkeep tasks and reminders

- **Status:** idea
- **Why:** upkeep that comes round again is easy to forget: descaling the
  kettle every month, backflushing the espresso machine, cleaning the burrs.
  Notes (built, see the roadmap) hold how to do it, but not when.
- **Approach:** recurring tasks in the workspace ("Descale the kettle,
  every 4 weeks"), each with when it was last done and a **Done** button.
  Due ones remind through the notification channels (§1b, like the rate
  later reminder) and could show as a nudge on the brew page. A task could
  link to the note that says how. A new table, so CLAUDE.md rule 8.
- **Size:** M
- **Depends on:** nothing (Notes is built).
- **Open questions:**
  - By time only, or also by use (every 200 shots, every 10 kg ground)?
  - Attach notes and tasks to a piece of equipment (the grinder, the
    espresso machine) and show them on its page? Overlaps with 34
    (roasting machine upkeep).
  - Who gets the reminder: everyone in the workspace, or whoever opts in?
  - Should the AI ever see notes, or their calculators (CLAUDE.md rule 9)?

### 24. Calculator templates: how many inputs

- **Status:** idea
- **Why:** a new calculator now starts from **Blank**, with one input (see
  the roadmap, "Notes: calculators"). The other templates still have two:
  **Amount per volume** (Water and Amount per litre), **Ratio** (coffee and
  ratio) and **Dilution** (total and strength). For a fixed recipe, like
  descaling at 20 g per litre where only the tank volume changes, the
  second input is in the way: you remove it and write the strength into the
  formula (`volume * 20`).
- **Approach:** to decide; options so far:
  - Amount per volume asks only for the volume, the strength in the
    formula. Quicker for a fixed recipe; changing the strength means
    editing the note.
  - A choice in the template: "fixed strength" or "strength you can
    change".
  Templates are `CALCULATOR_TEMPLATES` in `frontend/src/lib/noteBlocks.ts`;
  the test there checks each one works out.
- **Size:** S
- **Depends on:** nothing (calculators are built).
- **Open questions:**
  - Should Ratio and Dilution keep two inputs?
  - Should a calculator be able to mark an input as fixed (shown, not
    typed into on the Notes page) instead of moving it into the formula?

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

### 25. Live roast timer

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

### 26. Roast insights

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
- **Depends on:** nothing; 26 and 30 make it richer.
- **Open questions:** should the rest sweet spot offer to change the
  workspace's default rest days?

### 27. Compare roasts

- **Status:** idea
- **Why:** with several batches of one green coffee, it's hard to see which
  roast tasted best and what was different about it.
- **Approach:** the batches of a green coffee side by side: levels, times,
  temperatures, weight loss, development, and how each one's brews rated.
- **Size:** M
- **Depends on:** nothing; can share a branch with 26.

### 28. Roast again, and roast plans

- **Status:** idea
- **Why:** a good roast is worth repeating, and today the form starts empty.
- **Approach:**
  - **Roast again** on a roast's page copies its green coffee, machine,
    weights, temperatures and times as targets, like Repeat brew;
  - optionally a **plan** list: roasts to do next (green coffee, weight,
    for filter or espresso), ticked off when logged.
- **Size:** S–M (plans are the M)
- **Depends on:** nothing.

### 29. Running low on roasted coffee

- **Status:** idea
- **Why:** the low notice covers green coffee; running out of roasted coffee
  is what actually interrupts brewing.
- **Approach:** when a home-roasted bean (or all rested roasts together)
  drops below a threshold, a notice through the notification channels
  suggesting the next roast, like the `green-low` job
  (`docs/api/notifications.md` §1b).
- **Size:** S
- **Depends on:** nothing; pairs with 28's plans.
- **Open questions:** a threshold per workspace, or per green coffee?

### 30. Green coffee details and restocks

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

### 31. Cupping notes per roast

- **Status:** idea
- **Why:** brew ratings mix the roast with the brewing; cupping judges the
  roast itself.
- **Approach:** a short cupping form on a roast: aroma, sweetness, acidity,
  body, a score, and roast defects (scorching, tipping, baked,
  underdeveloped). Shown on the roast's page; feeds 25 and 26.
- **Size:** S–M
- **Depends on:** nothing.

### 32. Roast details for the AI

- **Status:** idea
- **Why:** for a home roast, how it was roasted explains a lot about how it
  brews.
- **Approach:** add the roast's level, development time, weight loss and
  days rested to the analysis context for brews of home-roasted beans.
  CLAUDE.md rule 9: decide always sent or switchable, and update
  `docs/api/llm-contract.md` §9.
- **Size:** S
- **Depends on:** nothing.

### 33. Roast curves

- **Status:** idea
- **Why:** roasting software (Artisan) records the whole curve; the log only
  keeps a few numbers.
- **Approach:** attach an Artisan `.alog` file to a roast and show bean
  temperature and rate of rise on its page; fill in the roast's times and
  temperatures from it.
- **Size:** L
- **Depends on:** nothing.

### 34. Roasting machine upkeep

- **Status:** idea
- **Why:** roasters need regular chaff and cleaning, easy to forget.
- **Approach:** batches since the last cleaning on each machine, a
  "Cleaned" button, and a reminder after a set number of roasts.
- **Size:** S
- **Depends on:** nothing.

---

## H. Accounts

### 35. Account management and password reset

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

### 36. Email verification

- **Status:** idea
- **Why:** anyone can register any address today, and nothing checks it's
  theirs. That's why server admin is granted on the server rather than by
  email, and it limits what an email can be trusted for: password reset
  (item 35), inviting a member by email, or notifications by email.
- **Approach:**
  - On registering (and on any later email change), send a link with a
    short-lived, single-use token; the account is marked verified when it's
    opened. Unverified accounts can sign in but see a "check your email"
    banner with a resend button.
  - Outgoing mail through SMTP settings in `.env` (host, port, user,
    password, from); without them, verification is off and the app says so.
  - Optionally `REQUIRE_VERIFIED_EMAIL=true` to block an unverified account
    from workspaces until it's verified.
  - Shares the mail and token pieces with password reset (item 35).
- **Size:** M (mail is new to the stack).
- **Depends on:** nothing; pairs with 35.
- **Open questions:**
  - Block unverified accounts, or only remind them?
  - What happens to accounts that existed before verification (treat as
    verified, or ask them once)?
  - Rate limits on resending, and how long a link stays valid.

---

## I. Deployment & the app

How the app is served and installed.

### 37. Test the installed app on phones

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

### 38. Protect the testing branch on GitHub

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

### 39. Back up every setting

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
