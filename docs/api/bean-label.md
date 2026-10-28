# 4d. Read the Bean Label

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

**"Fill in from the photos"** on the bean form sends the bean's photos
(§4c) to the AI, which reads the label and answers with the bean fields (§4)
it could read. The form fills the **empty** fields and, under each one that
already says something else, shows **"Label says: X · Use"**. Nothing is
saved until the bean is.

The photos come **with the request**: a new bean's aren't on the server
until it's saved, and that's when the label matters most. The browser
shrinks each to at most 1024 px (JPEG); for a saved bean it fetches its
stored photos. Nothing about the request is stored (no row, no file); the
job is kept a minute in Redis so the answer can be collected.

**How it's read:** the backend re-encodes each photo as a stored photo is
(upright, no metadata, ≤1024 px WebP; `backend/src/photos.ts`), queues a
`label-read` job (`LABEL_READ_QUEUE`, `@barista/shared/jobs`) with the
images and the workspace's visible **process** names (§4b), and waits for
the worker's answer, up to `LABEL_READ_TIMEOUT_MS` (default 60 s). The
worker asks the vision model (`OPENAI_VISION_MODEL`, else `OPENAI_MODEL`);
the request and how the answer is checked are in `llm-contract.md` §9c. It
isn't retried: the person presses the button again.

**What the form does with it** (`frontend/src/lib/labelFill.ts`):

- `processName` is one of the given processes, so it picks that process;
  a process that isn't one of them (`processText`) is added to the notes as
  "Process: …".
- `country` fills the country, and with it the growing area if that's empty.
- `altitudeMasl` shows in the person's altitude unit.
- Roast: with roast names (`roastScale` `names`) only `detailedRoastLevel`
  is used; with light to dark, `roastLevel`, or the level of the name.
- `decaf` is `true` or `null`: a label that says nothing about it doesn't
  untick it.
- A field the workspace hides (Settings → Fields) is shown when it's filled
  or suggested.

**The switch:** workspace setting `readLabels` (default `true`,
`workspaces.md` §2), under Settings → AI → **Bean labels**. The button
shows when it's on, the bean has photos and the person can edit.

## `POST /api/workspaces/:workspaceId/bean-label`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "images": ["<base64>", ...] }`: 1–6 photos (`MAX_BEAN_PHOTOS`),
  each the image file's bytes in base64 (no `data:` prefix), at most 3 MB
  decoded. The JSON body may be up to 25 MB.
- **Success (`200 OK`):** every field, `null` where it couldn't be read:

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
  }
}
```

- **Errors:** `400` invalid body, or a photo that isn't an image (`"Photo 2
  isn't an image that can be read"`); `403` viewer, or `readLabels` is off;
  `413` body over 25 MB; `502` the AI call failed (the provider's error,
  e.g. a model that can't take images, or an answer that didn't parse);
  `503` the queue is unreachable; `504` no answer in time.
