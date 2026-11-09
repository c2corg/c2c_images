# Image backend service

[![GitHub license](https://img.shields.io/github/license/c2corg/c2c_images)](https://github.com/c2corg/c2c_images/blob/master/LICENSE)
![Build status](https://github.com/c2corg/c2c_images/actions/workflows/ci.yml/badge.svg)
![Github code scanning](https://github.com/c2corg/c2c_images/actions/workflows/codeql-analysis.yml/badge.svg)
[![Codacy Badge](https://app.codacy.com/project/badge/Coverage/95980766784c4f99865629175b4c96b6)](https://www.codacy.com/gh/c2corg/c2c_images/dashboard)

This project handles receiving images from the user and generating smaller
versions. It is using docker to be able to run it either together with the
API machine or on a separate machine.

## Upload

The original image uploaded by the user is:

- optionally rotated according to the EXIF orientation value;
- uniquely renamed using a timestamp and random number;
- stored locally in an "incoming" directory;
- converted to smaller sizes.

The image is uploaded immediately to the incoming storage.
The user receives the renamed filename.

## Activation

The user associates the filename to a document, which is stored in the API.
At that time, a request is sent to image backend to move original and resized
images from the incoming bucket to the public bucket. This step ensures the
image is associated with an authenticated user.

## Configuration

Configuration should be set by environment variables. They are checked at
startup: the service refuses to start with a missing or invalid value, and
lists them. An empty variable counts as unset. Flags accept `1`, `true`,
`yes`, `on`, `y`, `enabled` and their opposites (`0`, `false`...).

`STORAGE_BACKEND`: (required) `s3` or `local`

- `s3`: requires `INCOMING_BUCKET` and `ACTIVE_BUCKET`, should be used in
  production.
- `local`: requires `INCOMING_FOLDER` and `ACTIVE_FOLDER`, should be used
  for tests and development.

`TEMP_FOLDER`: Local folder to store images temporarily. Default is
`<OSTMPDIR>/images/temp` where `<OSTMPDIR>` is the operating system's
default directory for temporary files.

`INCOMING_FOLDER`: Local folder for incoming files.

`ACTIVE_FOLDER`: Local folder for active files.

`INCOMING_BUCKET`: Name bucket for incoming files.

`INCOMING_PREFIX`: Prefix of the incoming bucket connection options.

`ACTIVE_BUCKET`: Name bucket for active files.

`ACTIVE_PREFIX`: Prefix of the active bucket connection options.

_PREFIX_`_ENDPOINT`: Endpoint url for corresponding prefix.

_PREFIX_`_ACCESS_KEY_ID`: API key for corresponding prefix.

_PREFIX_`_SECRET_KEY`: Secret key for corresponding prefix.

_PREFIX_`_DEFAULT_REGION`: (required) Region for corresponding prefix, used to
sign the requests (Exoscale: the zone, e.g. `ch-dk-2`).

`API_SECRET_KEY`: (required) API secret key, needed to publish images on the
active bucket.

`RESIZING_CONFIG`: The thumbnail sizes, in JSON, for example:

```json
[{ "suffix": "BI", "width": 1500, "height": 1500, "fit": "inside" }]
```

`fit`: `inside` keeps the proportions within the size, without enlarging;
`cover` fills the size, cropped around the center. Default: `BI` 1500x1500 and
`MI` 400x400 inside, `SI` 200x200 cover, as v6_images.

`AUTO_ORIENT_ORIGINAL`: `1` to rotate the uploaded image according to the
EXIF orientation. Default is `0`.

`GENERATE_WEBP`: `1` to generate webp thumbnails along with jpeg/png/gif
ones. Default is `0`.

`GENERATE_AVIF`: `1` to generate avif thumbnails along with jpeg/png/gif
ones. Default is `0`.

`INCOMING_CLEANUP`: `auto` (default) or `off`, see [Cleaning](#cleaning).
`INCOMING_MAX_AGE_HOURS`: Age of the files of the incoming bucket deleted.
Default is `24`. `INCOMING_CLEANUP_INTERVAL_MINUTES`: Default is `60`.
`INCOMING_CLEANUP_DRY_RUN`: `1` to only log. Default is `0`.

`THUMBNAILS_PUBLISH_DELAY`: Delay in ms before publishing the webp/avif
thumbnails not rendered yet when an image is published. Default is `20000`.

`JPEG_QUALITY`, `AVIF_QUALITY`, `WEBP_QUALITY`: Quality of the thumbnails,
per format: the scales differ. Defaults are `82` (JPEG, through mozjpeg),
`55` (AVIF) and `80` (WebP). `AVIF_EFFORT`: CPU spent by the AVIF encoder,
`0` (fast) to `9` (smaller files). Default is `3`: 4 to 5 times faster than
`4`, for files of the same size.

`AVIF_QUALITY_DRAWING`: Quality of the AVIF thumbnails of SVG drawings
(embedded raster images under half of the drawing), for sharp lines and text.
Default is `80`; SVGs with a photo use `AVIF_QUALITY`.

`CACHE_CONTROL`: Cache-Control value to be set to all the images uploaded
to s3. Default is `public, max-age=3600`.

`ALLOWED_ORIGINS`: Comma separated list of allowed origins for CORS requests.
This is currently only for the `/upload` endpoint. Default is `*`.

`MAX_UPLOAD_SIZE`: Maximum size of an uploaded file, in bytes (413 above).
Default is `31457280` (30 MiB).

`MAX_IMAGE_PIXELS`: Maximum width x height x frames of an uploaded image
(400 above), against decompression bombs. Default is `268402689` (16383²,
the limit of libvips).

`MAX_SVG_IMAGE_PIXELS`: Maximum width x height x frames of the raster images
embedded in an uploaded SVG, together (400 above). librsvg decodes them at
their full size, whatever the size of the thumbnails. Default is `25000000`.

Uploaded SVG are sanitized: only static drawings are kept, without scripts,
event handlers, animations or references to external resources.

`UPLOAD_RATE_LIMIT`: Uploads per minute and client address, on each instance
(429 above). Default is `100`.

`AUTH_FAILURE_RATE_LIMIT`: Requests to `/publish`, `/delete` and `/rotate`
with a missing or bad secret, per minute and client address, on each instance.
Then all of them are refused (429) until the end of the minute. Default is `10`.

`TRUST_PROXY`: Proxies whose `X-Forwarded-For` header gives the client
address (Express' `trust proxy`): a number of hops, `true`, `false`, or a
comma separated list of addresses, subnets or `loopback`, `linklocal`,
`uniquelocal`. Default is `loopback, uniquelocal` (HAProxy on a private
network).

`SERVICE_PORT`, `METRICS_PORT`, `METRICS_PATH`: Defaults are `8080`, `8081`
and `/metrics`. `DISABLE_PROMETHEUS_METRICS`: `1` to disable the metrics.

Here is an example configuration with S3 backend on exoscale:

```bash
STORAGE_BACKEND: s3

INCOMING_FOLDER:
ACTIVE_FOLDER:

INCOMING_BUCKET: c2corg_test_incoming
INCOMING_PREFIX: EXO
ACTIVE_BUCKET: c2corg_test_active
ACTIVE_PREFIX: EXO
EXO_ENDPOINT: https://sos-ch-dk-2.exo.io
EXO_DEFAULT_REGION: ch-dk-2
EXO_ACCESS_KEY_ID: xxx
EXO_SECRET_KEY: xxx

API_SECRET_KEY: xxx
```

## Endpoints

### health

`GET /ping`

Health check.

### upload

`POST /upload`

Parameters:

- file (File)

Publishes the image to the incoming bucket, along with its generated
thumbnails.

Supported file formats are:

- jpeg
- png
- gif
- svg
- heic (HEIF with HEVC images): stored as jpeg, upright, in sRGB, with its
  EXIF. The prebuilt libvips of sharp does not decode HEVC (patents): the
  image is decoded by libheif and libde265 compiled to WebAssembly
  ([heic-decode](https://github.com/catdad-experiments/heic-decode)), in a
  worker thread, two at a time. AVIF (HEIF with AV1 images) is not accepted.

Note that the server responds as soon as 'base' thumbnails are generated
(jpeg or png), but that modern formats (if enabled) are generated
asynchronously and may not be immediately available.

### publish

`POST /publish`

Parameters:

- secret (secret key)
- filename (key of the image to publish)

Moves the images and its thumbnails to the active bucket.

### delete

`POST /delete`

Parameters:

- secret (secret key)
- filenames (key(s) of the image(s) to delete)

Removes the image and its thumbnails from the active bucket.

### rotate

`POST /rotate`

Parameters:

- secret (secret key)
- filename (key of the image to be rotated)
- rotation (optional, 90, -90 or 180)

Rotates the image and its thumbnails in the active bucket.
A new key will be returned, in order to avoid cache issues.

Note that SVG files cannot be rotated.

As for the upload endpoint, modern formats (if enabled) are generated
asynchronously and may not be immediately available.

## Cleaning

The files of the incoming bucket never published (the user uploaded an image,
then did not save the document) expire after `INCOMING_MAX_AGE_HOURS`. With
`INCOMING_CLEANUP=auto` (the default, S3 storage only), at startup the service:

- leaves it to the bucket when a lifecycle rule already expires its files;
- creates that rule when the bucket has no lifecycle rules (S3 counts in days:
  the hours are rounded up). Existing rules are never replaced;
- otherwise (lifecycle rules not supported, not allowed to the keys, or other
  rules), deletes the expired files itself every
  `INCOMING_CLEANUP_INTERVAL_MINUTES`.

`INCOMING_CLEANUP_DRY_RUN=1` only logs what it would do. `npm run
clean:incoming` (`-- --dry-run`) deletes the expired files once.

## Testing

Images are processed by [sharp](https://sharp.pixelplumbing.com) (libvips,
with librsvg for SVG), installed by npm with its own binaries: nothing else to
install.

Tests use [Vitest](https://vitest.dev). Run the unit tests via `npm run test`,
or `npm run test:watch` while developing.

To include s3 tests, you need to run the in-memory S3 server (Scality
CloudServer) via docker: `docker compose -f docker-compose.s3.yml up -d s3`.
The tests create the buckets.
Then run all tests via `npm run test:all`. `npm run test:ci` also computes the
coverage (`reports/coverage`).

## Building and running with Docker

Use `docker build` to build an image of the service.

The image installs free fonts for the text of the SVGs: Arial is rendered with
Liberation Sans, Calibri with Carlito, and so on. `fonts/local.conf` maps the
other names the SVGs of the site use to the closest installed font
(Verdana: DejaVu Sans, Illustrator's `Arial-BoldMT`: Liberation Sans bold...).

## Creating a version

Use `npm version`.

## AVIF backfill

`npm run backfill:avif` (`node scripts/backfill-avif.js` in the image) renders
the missing AVIF thumbnails of the published images, from their originals, in
the order of their keys:

- `--dry-run`: only count the images without their AVIF thumbnails;
- `--limit=<n>`: stop after `n` images;
- `--start-after=<key>`: resume after the last image done (each progress
  line gives it, and so does the end of a stopped run);
- `--concurrency=<n>`: images rendered at the same time (default `1`);
- `--pause-ms=<ms>`: pause between two batches;
- `--reencode-jpeg`: also render again the JPEG thumbnails of the JPEG
  originals, with the current encoder.

For SVG originals, the JPEG thumbnails are always rendered again, from a
sanitized copy (the originals stored by v6_images were not sanitized).

`--sanitize-svg` also replaces the SVG originals by that sanitized copy, when
it differs, after their thumbnails: their scripts, event handlers and external
references could run when the file is opened directly. It takes every SVG,
with its AVIF thumbnails or not. `--svg-only` takes the SVG originals only,
to do them first.

`--sizes=<file>` appends `filename,width,height,file_size` of each original
rendered to a CSV file (created with its header), for the image documents of
v6_api: the size after the EXIF orientation, for an SVG its own width and
height.

SIGINT and SIGTERM stop it after the current batch. `AVIF_QUALITY` and
`AVIF_EFFORT` apply as for the uploads.

## Prometheus metrics

Prometheus metrics are exposed on port `METRICS_PORT` with path
`METRICS_PATH` (defaults to <http://localhost:8081/metrics>). Their names all
start with `c2corg_images_`, and their labels have a few values each (no image
key, address or user agent):

- `http_request_duration_seconds` (`method`, `route`, `code`): `route` is the
  route pattern, `unmatched` for unknown paths;
- `uploaded_images_total` (`format`), `refused_uploads_total` (`reason`:
  `format`, `svg`, `size`, `pixels`, `rate`), `rate_limited_requests_total`
  (`route`);
- `published_images_total`, `unpublished_thumbnails_total`,
  `deleted_images_total`, `rotated_images_total`;
- `thumbnail_duration_seconds` (`format`, `size`),
  `rotation_duration_seconds`, `autoorient_duration_seconds`;
- `s3_request_duration_seconds` (`operation`, `outcome`: `ok`, `not_found`,
  `error`);
- `incoming_cleanup_info` (`by`: `rule`, `service`, `off`),
  `incoming_cleanup_deleted_files_total`;
- `errors_total` (`kind`: `request` for the 500 answers, `background` for the
  work after the answer);
- `service_info` (`version`, `env`), and the process and Node.js metrics.

You can disable all metrics by setting `DISABLE_PROMETHEUS_METRICS` to `1`.

## v6_images

This project is a reimplementation of <https://github.com/c2corg/v6_images>
in node / typescript.
