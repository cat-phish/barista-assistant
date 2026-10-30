# Building your own flavor wheel

The app offers a flavor wheel when you taste a brew. It comes with a
built-in wheel. You can replace it with your own for your workspace: your
own words, your own groups, your own colours, or a wheel you've built from a
lexicon you use elsewhere.

A wheel is one JSON file. You build it however you like (by hand, from a
spreadsheet, with a script) and import it under **Settings → Lists →
Flavor wheel**. The API side is `docs/api/flavor-lexicon.md` §2c.

> **About other people's wheels.** This repository ships only its own
> built-in wheel, and it stays that way. Published wheels and lexicons
> (the SCA/WCR Coffee Taster's Flavor Wheel, for example) have their own
> licences, often non-commercial and no-derivatives, which don't fit this
> AGPL code. If you build a file from one, that's between you and its
> licence: check what it allows for your use, and keep the file out of
> this repository. `lexicons/` and `*.flavor-wheel.json` are git-ignored
> for that. Don't open pull requests that add one.

## The quickest start

1. **Settings → Lists → Flavor wheel → Download as JSON.** You get the
   current wheel as a valid file.
2. Change it: rename, add, remove, recolour.
3. **Import a wheel…** and pick the file. The app says what's wrong, and
   where, if anything is.

## The file

```json
{
  "format": "barista-flavor-lexicon",
  "version": 1,
  "name": "House wheel",
  "flavors": [
    { "key": "fruity", "label": "Fruity", "color": "#d0453f" },
    { "key": "fruity.citrus", "label": "Citrus" },
    { "key": "fruity.citrus.lemon", "label": "Lemon" },
    { "key": "fruity.citrus.grapefruit", "label": "Grapefruit", "color": "#f08a5d" },
    { "key": "fruity.berry", "label": "Berry" },
    { "key": "sweet", "label": "Sweet", "color": "#d98b2b" },
    { "key": "sweet.honey", "label": "Honey" }
  ]
}
```

| Field | Rule |
| --- | --- |
| `format` | Always `"barista-flavor-lexicon"`. |
| `version` | Always `1`. |
| `name` | What the wheel is called in Settings, 1–100 characters. |
| `flavors` | The flavors, 1–500 of them, **in the order the wheel shows them**. |

Each flavor:

| Field | Rule |
| --- | --- |
| `key` | Its id: lowercase `a–z`, `0–9` and `_`, at most 64 characters, unique. Dots place it on the wheel (see below). |
| `label` | What people see, 1–60 characters. Any language, any spelling. |
| `color` | Optional, `#rrggbb`. |

Anything else in the file is ignored and not kept, so a script can leave
its own notes in.

### Rings: what the dots mean

The wheel has up to **three rings**. A key with no dot is on the inner ring;
each dot is one ring further out, under the flavor before the dot:

```
fruity                    inner ring
fruity.citrus             middle ring, under Fruity
fruity.citrus.lemon       outer ring, under Citrus
```

- A flavor's parent must be **listed before it**. Listing each inner-ring
  flavor followed by everything under it is the natural way.
- Not every branch needs three rings: `roasted.tobacco` with nothing under
  it is fine, and reaches the edge of the wheel.
- Any ring can be picked. Picking "Citrus" says citrus without saying which.
- Each flavor's slice is sized by how many outer flavors it holds, so a
  group with many flavors gets more of the wheel.

### Colours

- Give the inner-ring flavors a colour each; everything under one takes a
  lighter shade of it unless it has its own. That's how the built-in wheel
  does it.
- An inner-ring flavor without a colour takes one from the built-in
  palette, in turn.
- The app picks dark or white text for each colour, whichever reads.

### Keys are forever, labels aren't

Brews save each pick's **key and its label at the time**. So:

- **Rename freely**: change the `label`, keep the `key`. Old brews show the
  new name.
- **Don't reuse a key for something else.** Old brews would show the new
  meaning.
- **Removing a flavor** is safe: brews that had it still show it by its old
  name (uncoloured), and the AI still reads it. It just can't be picked for
  new brews. Editing such a brew keeps it.
- Switching back to the built-in wheel works the same way.

### Limits

At most 500 flavors and three rings. Past about 12 inner-ring flavors, or
30 under one of them, slices get thin on a phone; the search box and the
list view still work at any size.

## Building it from something else

Anything that can write JSON works: a spreadsheet export, a script in any
language, a text editor. Two ways included here:

### From a spreadsheet (CSV)

`scripts/flavor-lexicon-from-csv.mjs` turns a CSV with one flavor per row
into a wheel file. Columns, named in the first row:

```csv
ring1,ring2,ring3,color
Fruity,,,#d0453f
Fruity,Citrus,Lemon,
Fruity,Citrus,Grapefruit,#f08a5d
Fruity,Berry,,
Sweet,,,#d98b2b
Sweet,Honey,,
```

- A row is the flavor at its last filled ring; `ring2` and `ring3` can be
  empty. A ring can't be empty above a filled one.
- Rings above a flavor that have no row of their own are added for you
  (the `Fruity,Citrus,Lemon` row adds Citrus if there's no Citrus row).
- Keys are made from the labels: `Stone fruit` → `stone_fruit`, accents
  dropped. Two flavors with the same label under the same parent become
  one.
- Rows keep their order, which is the wheel's order.

```sh
node scripts/flavor-lexicon-from-csv.mjs lexicons/my-flavors.csv --name "House wheel" > lexicons/house.flavor-wheel.json
```

It checks the result the same way the app does (after
`npm run build -w shared`) and prints what's wrong on stderr.

If you rebuild a wheel from an edited spreadsheet, keys come from the
labels, so **renaming a row changes its key**. To rename without losing the
link to old brews, change the `label` in the JSON instead, or keep a stable
`key` column in your own script.

### By hand or from your own script

Write the JSON directly. A checklist:

1. `format`, `version`, `name` at the top.
2. Every flavor has a `key` and a `label`.
3. Every key's parent (the part before its last dot) appears earlier in
   `flavors`.
4. No key appears twice.
5. Colours, if any, are `#` and six hex digits.

## Importing, and what happens

- Only workspace **owners** can import or reset; everyone in the workspace
  sees the new wheel.
- Importing replaces the whole wheel. There's no merge, so download the
  current one first if you might want it back.
- **Use the built-in wheel** in the same card goes back to the default.
- A workspace backup carries the wheel and restores it. Exporting and
  importing lists (Settings → Data) doesn't, but brews keep their picks'
  names either way.
