# 4d. Read the Bean Label

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The bean form's **Fill in with AI** card, under the Photos card (adding or
editing; `LabelCard.vue`), takes photos just for the read (**Take photo**,
**Choose photos**; shown as thumbnails to remove, the back of the bag, say)
and has **"Also read the bean's photos"** (ticked by default; §4c, a new
bean's picked ones too; not offered when photos are hidden under
Settings → Fields). Nothing is sent until **✦ Fill in from N photos** is
pressed: the AI reads the label and answers with the bean fields (§4) it
could read. Those taken here go first, then the bean's, at most **8** in
all (`LABEL_MAX_IMAGES`). The form fills
the **empty** fields and, under each one that already says something else,
shows **"Label says: X · Use"**. Nothing is saved until the bean is.

Photos taken for the read are **only read, then thrown away**: they never
become the bean's photos, so a back-of-the-bag shot doesn't have to be
uploaded and deleted again. All photos come with the request (a new bean's
aren't on the server yet; a saved bean's are fetched); the browser shrinks
each to at most 1024 px (JPEG). Nothing about the request is stored (no row, no file);
the job is kept a minute in Redis so the answer can be collected.

**How it's read:** the backend re-encodes each photo as a stored photo is
(upright, no metadata, ≤1024 px WebP; `backend/src/photos.ts`), queues a
`label-read` job (`LABEL_READ_QUEUE`, `@barista/shared/jobs`) with the
images and the workspace's visible **process** names (§4b), and waits for
the worker's answer, up to `LABEL_READ_TIMEOUT_MS` (default 60 s). The
worker asks the vision model (`OPENAI_VISION_MODEL`, else `OPENAI_MODEL`);
the request and how the answer is checked are in `llm-contract.md` §9c. It
uses the asker's own AI prompt (Settings → Your AI prompt, `auth.md` §1c):
their "Reading bean labels" instructions and their text for the "Reading a
bean label" section. It isn't retried: the person presses the button again.

**What the form does with it** (`frontend/src/lib/labelFill.ts`):

- `processName` is one of the given processes, so it picks that process;
  a process that isn't one of them (`processText`) is added to the notes as
  "Process: …".
- `country` fills the country, and with it the growing area if that's empty.
- `altitudeMasl` shows in the person's altitude unit.
- `varieties` and `species` fill the bean's lists (`null` = not printed); a
  list that differs from the form's is a suggestion for the whole list.
- Roast: with roast names (`roastScale` `names`) only `detailedRoastLevel`
  is used; with light to dark, `roastLevel`, or the level of the name.
- `decaf` is `true` or `null`: a label that says nothing about it doesn't
  untick it.
- A field the workspace hides (Settings → Fields) is shown when it's filled
  or suggested.

**Leaving while it reads:** the read runs app-wide
(`frontend/src/stores/labelRead.ts`), not in the form, so you can go
elsewhere in the app (start a timer) while it works. A notice under the
header says how it's going, then "Back to the bean"; the answer is applied
when that bean's form (or Add bean) is open again. One read at a time; an
older read's late answer is ignored. An unsaved Add bean (or Duplicate)
form is kept in memory meanwhile, fields and picked photos
(`stores/beanDraft.ts`): coming back says "Picked up where you left off ·
Start over"; saving or Cancel drops it. A reload loses both. "Web says"
suggestions from an earlier read stay until used, or until a later read
says something about that field.

**The switch:** workspace setting `readLabels` (default `true`,
`workspaces.md` §2), under Settings → AI → **Bean labels**. The buttons
show when it's on (the bean form is for those who can edit).

**Looking it up on the web** (optional): with the workspace's
`labelWebLookup` (default `false`, same place), the card has **"Also look it
up on the web"**, unticked each time, noting that it takes longer. Ticked,
once the label is read the browser sends what it says (never the photos,
the roast date or the batch number) to `POST …/bean-label/web`, its own
request: a model with a web search (`llm-contract.md` §9c, step 2), kept to
the roaster's site when its address is known (read off the label, else the
form's Website). The two are separate so a slow or failed search doesn't
lose the label, and each has its own wait. The card's **"Look it up on the
web"** button sends the same request on its own, from what the form says
now (typed in, or filled by an earlier read; it needs the roaster or the
coffee): to try the search again without reading the photos again, or with
no photos at all. What it finds is **only ever suggested**:
"Web says: X · source · Use" under the field, the link to the page it's on;
nothing it finds fills a field by itself. Not shown where it says what the
form (after the label) already says, or where the label already suggested
something. How much of each page it reads is the workspace's
`labelWebContext` (Low, Medium, High; default High). The wait is
`LABEL_WEB_TIMEOUT_MS` (default 120 s). If the
lookup fails, the label is still read and `webError` says so: either the
provider or model doesn't do web search, or it didn't manage this time (try
the button again). Under the card's summary, **the pages it looked
at** are listed as links ("Pages the web lookup looked at, for anything it
missed"), so what wasn't picked out (often the altitude) can be found by
hand; a later read without the lookup keeps them, Start over clears them.

## `POST /api/workspaces/:workspaceId/bean-label`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "images": ["<base64>", ...] }`: 1–8 photos
  (`LABEL_MAX_IMAGES`), each the image file's bytes in base64 (no `data:`
  prefix), at most 3 MB decoded; the JSON body may be up to 25 MB.
- **Success (`200 OK`):** every label field, `null` where it couldn't be
  read, with `web: null`, `webSources: []`, `webError: null` (the shape the
  form takes; the web lookup is the next route):

```json
{
  "fields": {
    "roasterName": "Onyx Coffee Lab",
    "beanName": "Geometry",
    "processName": "Washed",
    "processText": null,
    "country": "Ethiopia",
    "region": "Guji",
    "producer": null,
    "altitudeMasl": 2100,
    "varieties": ["Heirloom"],
    "species": null,
    "flavorProfile": "Peach, jasmine, bergamot",
    "roastDate": "2026-10-20",
    "detailedRoastLevel": "city",
    "roastLevel": null,
    "roastType": "filter",
    "blendType": "single_origin",
    "decaf": null,
    "bagWeightGrams": 340,
    "batchNumber": null,
    "website": "https://onyxcoffeelab.com/"
  },
  "web": null,
  "webSources": [],
  "webError": null
}
```

- **Errors:** `400` invalid body, or a photo that isn't an image (`"Photo 2
  isn't an image that can be read"`); `403` viewer or `readLabels` is off;
  `413` body over 25 MB; `502` the AI call failed (the provider's error,
  e.g. a model that can't take images, or an answer that didn't parse);
  `503` the queue is unreachable; `504` no answer in time.

## `POST /api/workspaces/:workspaceId/bean-label/web`

Looks a bean up on the web on its own: after a label read, again, or from
what was typed in.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "fields": { ... } }`: what's known of the bean, any of the
  label fields except `roastDate` and `batchNumber` (they belong to one bag;
  sent, they're a `400`), each optional; blank text is `null`. Needs
  `roasterName` or `beanName`. `website` keeps the search to that site.
- **Queued** as a `label-read` job with no images and `lookUp` (the fields,
  the rest `null`), waiting up to `LABEL_WEB_TIMEOUT_MS` (default 120 s).
- **Success (`200 OK`):** `web`, what the web added (`LabelWebFinds`: only
  the fields found, each `{ value, url }`; never `roastDate` or
  `batchNumber`), or `null` when the lookup failed; `webSources`, the pages
  it looked at (those a value came from first, then the rest it visited or
  cited; once each, without `utm_` parameters or `#fragment`, on the
  roaster's site when limited to it, at most 8), `[]` when it failed;
  `webError`, why it failed: the provider or model doesn't do web search,
  or it didn't manage this time:

```json
{
  "web": {
    "producer": { "value": "Many smallholders, Worka", "url": "https://onyxcoffeelab.com/products/geometry" }
  },
  "webSources": [
    "https://onyxcoffeelab.com/products/geometry",
    "https://onyxcoffeelab.com/collections/coffee"
  ],
  "webError": null
}
```

- **Errors:** `400` invalid body or no name; `403` viewer, `readLabels` or
  `labelWebLookup` is off; `502` the job itself failed; `503` the queue is
  unreachable; `504` no answer in time.

