# 4c. Bean Photos

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

A bean (§4) can have up to **6 photos** (`MAX_BEAN_PHOTOS`): the bag, its
label, the roaster's card. The first is the **cover**, which the bean list
shows beside the name; the bean's details show them all, and the bean form
(its Photos card, at the top) adds and removes them, and reorders them by
dragging ⠿ (or its arrow keys): whichever is first is the cover.

**One size only.** The server keeps no original: on upload it turns the
image upright (its EXIF orientation), fits it inside **1024 px** on the long
edge (never enlarging), and stores it as **WebP** (quality 80) with **no
metadata** (no GPS, camera or date). Only its id, position and size are in
the database (`bean_photos`, `docs/schema.md`); the file is
`PHOTO_DIR/<workspaceId>/<photoId>.webp` (`backend/src/photos.ts`;
`PHOTO_DIR` defaults to `/photos`, mounted from `./photos` in
`docker-compose.yml`).

**Crop and rotate** happen in the browser (`PhotoCropDialog.vue`, on
Cropper.js): a free box or a square, and quarter turns. A photo picked for a
new bean is swapped for the cropped file before it's uploaded; a saved one
is replaced in place (`PUT …/image` below). Since only the 1024 px copy is
kept, cropping a saved photo again starts from that, so it gets smaller each
time. No confirmation: the editor's Done says it replaces the saved photo.

**Every bean** the API returns (§4) carries its photos, cover first:

```json
"photos": [
  { "id": "uuid", "width": 768, "height": 1024 },
  { "id": "uuid", "width": 1024, "height": 683 }
]
```

**Deleting** a photo, its bean or the workspace removes the files too
(after the database change); the backend also sweeps files with no row on
start. A Duplicate (a new bag) starts without photos.

**Backups:** a JSON backup leaves photos out (no `bean_photos` rows); a
`.zip` backup has them (`backup.md` §2b). The server's scheduled database
dumps (§10) don't include `./photos`: back that folder up with them.

**Offline:** a photo never changes for its id, so it's sent with
`Cache-Control: private, max-age=31536000, immutable`, and the PWA keeps
the ones you've seen (`bean-photos` cache, `docs/timer_architecture.md`).

**Reading the label:** the "Fill in with AI" card below can read these,
with any taken just for the read (`bean-label.md` §4d).

**Settings → Fields** can hide photos (`bean.photos`): off the form and the
list; a bean that has some still shows them on its form.

## `POST /api/workspaces/:workspaceId/beans/:beanId/photos`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** the image file itself (not JSON), at most **15 MB**, with its
  `Content-Type` (any: what counts is whether it decodes). JPEG, PNG, WebP,
  GIF, AVIF and TIFF are read; HEIC isn't (phones' file pickers send JPEG).
- **Success (`201 Created`):** `{ "photo": { "id", "width", "height" } }`,
  added last.
- **Errors:** `400` not an image that can be read; `403` viewer; `404` bean
  not in this workspace; `409` the bean already has 6; `413` over 15 MB.

## `GET /api/workspaces/:workspaceId/beans/:beanId/photos/:photoId`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** the image, `image/webp`, cacheable for good (above).
- **Errors:** `404` no such photo of this bean in this workspace.

## `PUT /api/workspaces/:workspaceId/beans/:beanId/photos/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "photoIds": ["uuid", ...] }`: every photo of the bean exactly
  once, in the new order; the first becomes the cover.
- **Success (`200 OK`):** `{ "photos": [ ... ] }` in that order.
- **Errors:** `400` invalid body, or not every photo exactly once; `403`
  viewer; `404` bean not in this workspace.

## `PATCH /api/workspaces/:workspaceId/beans/:beanId/photos/:photoId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "cover": true }`: makes it the first photo; the others keep
  their order.
- **Success (`200 OK`):** `{ "photos": [ ... ] }`, the bean's photos in their
  new order.
- **Errors:** `400` invalid body; `403` viewer; `404` no such photo.

## `PUT /api/workspaces/:workspaceId/beans/:beanId/photos/:photoId/image`

A new image for a photo (cropped or rotated), in its place.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** the image file, as for `POST` (15 MB, any decodable type); it's
  processed the same way.
- **Success (`200 OK`):** `{ "photo": { "id", "width", "height" }, "photos":
  [ ... ] }`. The photo gets a **new id** at the same position (the cover
  stays the cover), because an image never changes for its id (cached for
  good); the old file is removed. Works on a bean that already has 6.
- **Errors:** `400` not an image that can be read; `403` viewer; `404` no
  such photo of this bean in this workspace.

## `DELETE /api/workspaces/:workspaceId/beans/:beanId/photos/:photoId`

No confirmation: nothing else uses a photo.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**; the next one becomes the cover if it was.
- **Errors:** `403` viewer; `404` no such photo.
