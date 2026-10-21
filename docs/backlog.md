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

---

## 1. Settings section

- **Status:** idea
- **Why:** configuration is hard-coded (recipe styles, the roast level
  recipes assume, display units) or scattered. A Settings section gives these
  one obvious home.
- **Approach:**
  - A **Settings** item in the header nav, with tabs. Start with **Styles**
    (item 2), **Units & defaults** (item 3) and **Workspace** (name, slug,
    public menu switch, members), the last moving from the workspace screen.
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

## 2. Editable style lists

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

## 3. Units and defaults

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

## 4. Ingredient prep and stock

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

## 5. Public menu page

- **Status:** idea
- **Why:** the public menu API exists (sections by category, brewers and
  drinks, beans) but nothing shows it.
- **Approach:** a public, read-only page at `/menu/:slug` that works offline
  (the PWA cache is already planned in `timer_architecture.md`). It shows the
  sections, then beans.
- **Size:** M
- **Depends on:** nothing.
- **Open questions:** styling and branding per workspace?

## 6. Espresso dose and yield suggestions from the AI

- **Status:** idea
- **Why:** the AI suggests grind and temperature changes; for espresso, dose
  and shot weight (ratio) are often the better lever.
- **Approach:** extend the structured output (`docs/api_spec.md` §9) with
  optional dose and yield deltas for espresso brews, and show them with the
  suggestion. Prompt and schema change, plus UI.
- **Size:** S–M
- **Depends on:** nothing.
- **Open questions:** should it also suggest pre-infusion and profile changes
  for machines that support them?
