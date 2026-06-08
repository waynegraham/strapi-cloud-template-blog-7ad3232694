# IIIF Image Uploads with Strapi, S3-Compatible Storage, and Cantaloupe

This guide describes how to set up a workflow where editors upload images in Strapi, the originals are stored in S3-compatible object storage, and Cantaloupe serves those images through the IIIF Image API.

The core idea is:

```txt
Strapi uploads originals -> S3-compatible bucket -> Cantaloupe reads originals -> IIIF URLs and manifests
```

Strapi should manage editorial metadata, upload records, ordering, and IIIF manifests. Cantaloupe should serve image tiles, thumbnails, resized images, and `info.json` responses.

## 1. Choose the Storage Layout

Use one bucket and a stable prefix for IIIF originals:

```txt
bucket: your-bucket
prefix: iiif/originals/
```

Example object keys:

```txt
iiif/originals/work-123/page-001.tif
iiif/originals/work-123/page-002.tif
iiif/originals/work-123/page-003.tif
```

Cantaloupe identifiers should be the S3 object key minus the configured Cantaloupe path prefix.

Example:

```txt
S3 key:                 iiif/originals/work-123/page-001.tif
Cantaloupe path prefix: iiif/originals/
Cantaloupe identifier:  work-123/page-001.tif
```

When used in a IIIF URL, the slash in the identifier must be URL-encoded:

```txt
https://iiif.example.org/iiif/3/work-123%2Fpage-001.tif/info.json
```

## 2. Install the Strapi S3 Upload Provider

Install Strapi's S3 upload provider:

```bash
npm install @strapi/provider-upload-aws-s3
```

This provider works with Amazon S3 and S3-compatible storage providers such as MinIO, Cloudflare R2, Scaleway Object Storage, and Ceph.

## 3. Configure Strapi Uploads

Edit `config/plugins.js`:

```js
module.exports = ({ env }) => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        baseUrl: env('S3_PUBLIC_URL'),
        rootPath: env('S3_ROOT_PATH', 'iiif/originals'),
        s3Options: {
          endpoint: env('S3_ENDPOINT'),
          forcePathStyle: env.bool('S3_FORCE_PATH_STYLE', true),
          credentials: {
            accessKeyId: env('S3_ACCESS_KEY_ID'),
            secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
          },
          region: env('S3_REGION', 'us-east-1'),
          params: {
            Bucket: env('S3_BUCKET'),
            ACL: env('S3_ACL', 'private'),
          },
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
});
```

Add the matching environment variables:

```env
S3_ENDPOINT=https://s3.example.org
S3_BUCKET=your-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=replace-me
S3_SECRET_ACCESS_KEY=replace-me
S3_FORCE_PATH_STYLE=true
S3_ROOT_PATH=iiif/originals
S3_PUBLIC_URL=https://assets.example.org
S3_ACL=private
```

Use `S3_ACL=private` if Cantaloupe is the only service that should read original images. Use a public ACL only if you intentionally want direct browser access to originals.

## 4. Configure Cantaloupe

Configure Cantaloupe to read from the same bucket and prefix.

Example `cantaloupe.properties`:

```properties
source.static = S3Source
s3source.lookup_strategy = BasicLookupStrategy

s3source.basiclookupstrategy.bucket.name = your-bucket
s3source.basiclookupstrategy.bucket.region = us-east-1
s3source.basiclookupstrategy.path_prefix = iiif/originals/
s3source.basiclookupstrategy.path_suffix =

s3source.endpoint = https://s3.example.org
s3source.access_key_id = replace-me
s3source.secret_access_key = replace-me

endpoint.iiif.2.enabled = true
endpoint.iiif.3.enabled = true
base_uri = https://iiif.example.org

cache.server.derivative.enabled = true
cache.client.enabled = true
```

With this configuration, if Strapi stores this object:

```txt
iiif/originals/work-123/page-001.tif
```

Cantaloupe should be able to serve:

```txt
https://iiif.example.org/iiif/3/work-123%2Fpage-001.tif/info.json
```

For local testing, the same pattern works with MinIO by setting:

```properties
s3source.endpoint = http://minio:9000
```

## 5. Create the Strapi Content Model

Create an `IIIF Asset` collection type related to `Work`.

Suggested fields:

```txt
title
Type: Text

work
Type: Relation
Relation: many IIIF Assets to one Work

images
Type: Component
Component: IIIF Image
Repeatable: true

processingState
Type: Enumeration
Values: draft, uploaded, processing, ready, failed
Default: draft
Required: true

manifestUrl
Type: Text

iiifBaseUrl
Type: Text

processingErrors
Type: JSON
```

Do not name the lifecycle field `status`. Strapi 5 reserves `status`, so use `processingState`.

Create an `IIIF Image` component.

Suggested fields:

```txt
file
Type: Media
Multiple: false
Allowed types: Images
Required: true

sequence
Type: Number
Format: Integer
Required: true

label
Type: Text

s3Key
Type: Text
Required: true

cantaloupeIdentifier
Type: Text
Required: true

width
Type: Number
Format: Integer

height
Type: Number
Format: Integer

infoJsonUrl
Type: Text

thumbnailUrl
Type: Text

caption
Type: Text

rightsStatement
Type: Relation (many-to-one) to Rights Statement

rightsNote
Type: Text
Use only for unmatched or verbatim local wording.
```

## 6. Derive the Cantaloupe Identifier

After an image is uploaded, Strapi stores a Media Library record. Use the uploaded file URL or provider metadata to derive the actual S3 key.

The rule is:

```txt
cantaloupeIdentifier = s3Key without the Cantaloupe path prefix
```

Example:

```txt
s3Key:                 iiif/originals/work-123/page-001.tif
path prefix:           iiif/originals/
cantaloupeIdentifier:  work-123/page-001.tif
infoJsonUrl:           https://iiif.example.org/iiif/3/work-123%2Fpage-001.tif/info.json
```

Do not assume the browser filename is the final S3 key. Strapi's upload provider may rename files or use hash-based names. Always use the actual stored object key.

## 7. Validate Uploaded Images

After upload, move the IIIF asset through these states:

```txt
draft -> uploaded -> processing -> ready
```

If validation fails:

```txt
processing -> failed
```

Recommended validation steps:

1. Confirm each image has a Strapi media record.
2. Confirm the derived S3 key exists.
3. Build the Cantaloupe `info.json` URL.
4. Fetch `info.json`.
5. Store `width`, `height`, and `infoJsonUrl`.
6. Mark the IIIF asset `ready` only when every image validates.

Example `info.json` URL:

```txt
https://iiif.example.org/iiif/3/work-123%2Fpage-001.tif/info.json
```

## 8. Generate the IIIF Manifest from Strapi

Add a custom route for a work or IIIF asset:

```txt
GET /api/works/:id/iiif/manifest
```

or:

```txt
GET /api/iiif-assets/:id/manifest
```

The manifest should be generated from Strapi metadata and should reference Cantaloupe services for each image.

Each image becomes one IIIF Canvas. Each Canvas should include:

```txt
id
type: Canvas
label
height
width
items
```

Each annotation body should point to Cantaloupe:

```json
{
  "id": "https://iiif.example.org/iiif/3/work-123%2Fpage-001.tif/full/max/0/default.jpg",
  "type": "Image",
  "format": "image/jpeg",
  "height": 3000,
  "width": 2000,
  "service": [
    {
      "id": "https://iiif.example.org/iiif/3/work-123%2Fpage-001.tif",
      "type": "ImageService3",
      "profile": "level2"
    }
  ]
}
```

## 9. Preview the Asset

Use two preview stages:

```txt
Immediate preview: Strapi media thumbnail or upload URL
IIIF preview: Cantaloupe URL after info.json validates
```

For a full IIIF preview, use a viewer such as Mirador, Universal Viewer, or OpenSeadragon against the generated manifest URL.

## 10. Troubleshooting

If Strapi upload succeeds but Cantaloupe returns 404:

```txt
Check that Cantaloupe bucket name matches Strapi bucket.
Check that Cantaloupe path_prefix matches Strapi rootPath.
Check that the IIIF identifier is the S3 key minus path_prefix.
Check that the identifier is URL-encoded in the IIIF URL.
Check that Cantaloupe credentials can read the object.
```

If Cantaloupe cannot read from S3-compatible storage:

```txt
Check s3source.endpoint.
Check force path-style requirements on the storage provider.
Check access key permissions.
Check bucket region.
Check whether the object is private and readable by Cantaloupe.
```

If the preview works from Strapi but not Cantaloupe:

```txt
Strapi may be using a public asset URL while Cantaloupe uses private S3 credentials.
Verify the actual object key in the bucket.
Verify that Cantaloupe is configured with the same key prefix.
```

## 11. Production Notes

Keep originals private where possible. Let Cantaloupe expose only IIIF Image API responses.

Use a derivative cache for Cantaloupe so repeated tile and thumbnail requests do not repeatedly process the same source image.

Use stable identifiers. Changing identifiers later will break manifests, bookmarks, and viewer state.

Keep the Strapi manifest route deterministic. A published IIIF asset should always generate the same manifest for the same image order and metadata.
