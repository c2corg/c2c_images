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

- optionally rotated according to the EXIF orientation value
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

Configuration should be set by environment variables:

`STORAGE_BACKEND`: (required) `s3` or `local`

- `s3`: requires `INCOMING_BUCKET` and `ACTIVE_BUCKET`, should be used in
  production.
- `local`: requires `INCOMING_FOLDER` and `ACTIVE_FOLDER`, should be used
  for tests and development.

`TEMP_FOLDER`: (required) Local folder to store images temporarily.

`INCOMING_FOLDER`: Local folder for incoming files.

`ACTIVE_FOLDER`: Local folder for active files.

`INCOMING_BUCKET`: Name bucket for incoming files.

`INCOMING_PREFIX`: Prefix of the incoming bucket connection options.

`ACTIVE_BUCKET`: Name bucket for active files.

`ACTIVE_PREFIX`: Prefix of the active bucket connection options.

_PREFIX_`_ENDPOINT`: Endpoint url for corresponding prefix.

_PREFIX_`_ACCESS_KEY_ID`: API key for corresponding prefix.

_PREFIX_`_SECRET_KEY`: Secret key for corresponding prefix.

_PREFIX_`_DEFAULT_REGION`: Default region for corresponding prefix.

`API_SECRET_KEY`: API secret key, needed to publish images on the active
bucket.

`RESIZING_CONFIG`: Configuration of the thumbnail names and sizes serialized
in JSON. See src/config.ts for a description of the format.

`AUTO_ORIENT_ORIGINAL`: `1` to rotate the uploaded image according to the
EXIF orientation. Default is `0`.

`CACHE_CONTROL`: Cache-Control value to be set to all the images uploaded
to s3. Default is `public, max-age=3600`.

Here is an example configuration with S3 backend on exoscale:

```bash
STORAGE_BACKEND: s3

TEMP_FOLDER: /srv/images/temp
INCOMING_FOLDER:
ACTIVE_FOLDER:

INCOMING_BUCKET: c2corg_test_incoming
INCOMING_PREFIX: EXO
ACTIVE_BUCKET: c2corg_test_active
ACTIVE_PREFIX: EXO
EXO_ENDPOINT: https://sos.exo.io
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

### publish

`POST /publish`

Parameters:

- secret (JWT token)
- filename (key of the image to publish)

Moves the images and its thumbnails to the active bucket.

### delete

`POST /delete`

Parameters:

- secret (JWT token)
- filenames (key(s) of the image(s) to delete)

Removes the image and its thumbnails from the active bucket.

### rotate

`POST /rotate`

Parameters:

- secret (JWT token)
- filename (key of the image to be rotated)
- rotation (optional, 90, -90 or 180)

Rotates the image and its thumbnails in the active bucket.
A new key will be returned, in order to avoid cache issues.

## Cleaning

The files which were not activated are automatically expired by S3 after 2
hours.

For S3-compatible versions that don't support lifecycle management, such as
Exoscale SOS, you can use the `npm run clean:incoming` command to remove
expired images.

## Testing

You need `rsvg-convert` and `imagemagick` installed.

Run unit tests via `npm run test`

For s3 tests, you need to run a local instance of minio via docker
`docker-compose -f docker-compose-minio.yml up`.
Then run s3 tests via `npm run test:s3`

## Building and running with Docker

Use `docker build` to build an image of the service.

## Creating a version

Use `npm version`.

## Prometheus metrics

Several prometheus metrics are exposed on port `METRICS_PORT` with path
`METRICS_PATH` (defaults to <http://localhost:8081/metrics>).

You can disable all metrics by setting `DISABLE_PROMETHEUS_METRICS` to `1`.

## v6_images

This project is a reimplementation of <https://github.com/c2corg/v6_images>
in node / typescript.
