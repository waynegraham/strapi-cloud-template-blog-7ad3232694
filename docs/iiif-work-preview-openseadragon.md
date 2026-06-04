# Work-Level IIIF Manifest Preview with OpenSeadragon

This guide describes how to preview a `Work` as a IIIF object using OpenSeadragon.

The intended flow is:

```txt
Work -> IIIF Asset -> ordered IIIF Images -> Strapi manifest route -> OpenSeadragon preview
```

OpenSeadragon should load Cantaloupe IIIF Image API `info.json` URLs. Strapi should provide the IIIF Presentation manifest that tells the preview which images belong to the work and in what order.

## 1. Confirm the Content Model

The current `Work` model already has a one-to-many relation to `IIIF Asset`:

```txt
Work.iiif_assets -> IIIF Asset.work
```

Before building the preview, make sure `IIIF Asset` can also load its ordered images. The current `IIIF Image` model exists, but it needs a relation to `IIIF Asset`.

Recommended relation:

```txt
IIIF Asset
  images
  Type: Relation
  Relation: one IIIF Asset has many IIIF Images

IIIF Image
  iiifAsset
  Type: Relation
  Relation: many IIIF Images belong to one IIIF Asset
```

Keep `IIIF Image.sequence` as the page/order field.

## 2. Required IIIF Image Fields

Each `IIIF Image` needs enough information to build a Canvas and an OpenSeadragon tile source:

```txt
file
sequence
label
cantaloupeIdentifier
width
height
infoJsonUrl
thumbnailUrl
rights
```

`infoJsonUrl` should point to Cantaloupe:

```txt
https://iiif.example.org/iiif/3/work-123%2Fpage-001.tif/info.json
```

If `infoJsonUrl` is not stored, it can be derived from:

```txt
IIIF_BASE_URL + /iiif/3/ + encodeURIComponent(cantaloupeIdentifier) + /info.json
```

For identifiers containing slashes, encode the slash as `%2F`.

## 3. Add a Work Manifest Route

Add a custom route:

```txt
GET /api/works/:id/iiif/manifest
```

This route should:

1. Load the `Work`.
2. Load related `iiif_assets`.
3. Pick the relevant `IIIF Asset`.
4. Load its related `IIIF Images`.
5. Sort images by `sequence`.
6. Return a IIIF Presentation API 3 manifest.

Example custom route file:

```js
// src/api/work/routes/iiif-manifest.js
'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/works/:id/iiif/manifest',
      handler: 'work.iiifManifest',
      config: {
        auth: false,
      },
    },
  ],
};
```

Then extend the Work controller:

```js
// src/api/work/controllers/work.js
'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

function encodeIiifIdentifier(identifier) {
  return encodeURIComponent(identifier).replace(/%2F/g, '%2F');
}

function getLabel(value, fallback) {
  return {
    en: [value || fallback],
  };
}

module.exports = createCoreController('api::work.work', ({ strapi }) => ({
  async iiifManifest(ctx) {
    const { id } = ctx.params;

    const work = await strapi.entityService.findOne('api::work.work', id, {
      populate: {
        iiif_assets: {
          populate: {
            images: true,
          },
        },
      },
    });

    if (!work) {
      return ctx.notFound('Work not found');
    }

    const iiifAsset = work.iiif_assets?.[0];

    if (!iiifAsset) {
      return ctx.notFound('No IIIF asset found for this work');
    }

    const iiifBaseUrl = (iiifAsset.iiifBaseUrl || process.env.IIIF_BASE_URL || '').replace(/\/$/, '');
    const images = [...(iiifAsset.images || [])].sort((a, b) => {
      return (a.sequence || 0) - (b.sequence || 0);
    });

    const manifestId = `${strapi.config.get('server.url') || ''}/api/works/${id}/iiif/manifest`;

    ctx.body = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: manifestId,
      type: 'Manifest',
      label: getLabel(work.titleEn, `Work ${id}`),
      items: images.map((image, index) => {
        const identifier = encodeIiifIdentifier(image.cantaloupeIdentifier);
        const serviceId = `${iiifBaseUrl}/iiif/3/${identifier}`;
        const canvasId = `${manifestId}/canvas/${image.id}`;
        const annotationPageId = `${canvasId}/page`;
        const annotationId = `${annotationPageId}/annotation`;
        const width = image.width || 1000;
        const height = image.height || 1000;

        return {
          id: canvasId,
          type: 'Canvas',
          label: getLabel(image.label, `Image ${index + 1}`),
          width,
          height,
          items: [
            {
              id: annotationPageId,
              type: 'AnnotationPage',
              items: [
                {
                  id: annotationId,
                  type: 'Annotation',
                  motivation: 'painting',
                  target: canvasId,
                  body: {
                    id: `${serviceId}/full/max/0/default.jpg`,
                    type: 'Image',
                    format: 'image/jpeg',
                    width,
                    height,
                    service: [
                      {
                        id: serviceId,
                        type: 'ImageService3',
                        profile: 'level2',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };
      }),
    };
  },
}));
```

Adjust the `populate` shape if your relation is named something other than `images`.

## 4. Install OpenSeadragon

Install OpenSeadragon wherever the preview UI lives:

```bash
npm install openseadragon
```

This can be a separate frontend app, a local preview page, or a Strapi admin customization.

## 5. Create a Manifest Preview Component

OpenSeadragon does not need to understand the whole manifest. The preview component can fetch the manifest, extract the Cantaloupe image services, convert each service to an `info.json` URL, and load those URLs in sequence mode.

```jsx
import { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';

function getTileSourcesFromManifest(manifest) {
  return (manifest.items || [])
    .flatMap((canvas) => canvas.items || [])
    .flatMap((annotationPage) => annotationPage.items || [])
    .map((annotation) => annotation.body)
    .filter(Boolean)
    .map((body) => {
      const services = Array.isArray(body.service) ? body.service : [body.service];
      const service = services.find((item) => {
        return item?.type === 'ImageService3' || item?.['@type'] === 'iiif:ImageService2';
      });

      if (!service) return null;

      const serviceId = service.id || service['@id'];
      return `${serviceId.replace(/\/$/, '')}/info.json`;
    })
    .filter(Boolean);
}

export function IiifManifestPreview({ manifestUrl }) {
  const viewerElementRef = useRef(null);
  const viewerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setError(null);

      try {
        const response = await fetch(manifestUrl);

        if (!response.ok) {
          throw new Error(`Manifest request failed with status ${response.status}`);
        }

        const manifest = await response.json();
        const tileSources = getTileSourcesFromManifest(manifest);

        if (!tileSources.length) {
          throw new Error('The manifest does not contain IIIF image services.');
        }

        if (cancelled) return;

        if (viewerRef.current) {
          viewerRef.current.destroy();
        }

        viewerRef.current = OpenSeadragon({
          element: viewerElementRef.current,
          prefixUrl: '/openseadragon/images/',
          tileSources,
          sequenceMode: true,
          showReferenceStrip: true,
          showNavigator: true,
          navigatorPosition: 'BOTTOM_RIGHT',
          preserveViewport: false,
          visibilityRatio: 1,
          constrainDuringPan: true,
        });
      } catch (error) {
        if (!cancelled) {
          setError(error.message);
        }
      }
    }

    loadPreview();

    return () => {
      cancelled = true;

      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [manifestUrl]);

  return (
    <div>
      {error ? <p>{error}</p> : null}
      <div
        ref={viewerElementRef}
        style={{
          width: '100%',
          height: '70vh',
          background: '#111',
        }}
      />
    </div>
  );
}
```

## 6. Add OpenSeadragon Button Assets

OpenSeadragon uses image assets for its default controls.

Copy these files into your public frontend assets:

```txt
node_modules/openseadragon/build/openseadragon/images/
```

If the preview app serves static files from `public/`, place them at:

```txt
public/openseadragon/images/
```

Then keep:

```js
prefixUrl: '/openseadragon/images/'
```

## 7. Use the Component for a Work Preview

For a work with ID `123`, the preview URL is:

```txt
/api/works/123/iiif/manifest
```

Render:

```jsx
<IiifManifestPreview manifestUrl="/api/works/123/iiif/manifest" />
```

For an external frontend, use the full CMS URL:

```jsx
<IiifManifestPreview manifestUrl="https://cms.example.org/api/works/123/iiif/manifest" />
```

## 8. Add a Strapi Admin Preview Entry Point

The simplest admin integration is a preview button on the `Work` edit page that opens a frontend preview route.

Example target URL:

```txt
https://frontend.example.org/iiif-preview/work/123
```

That frontend route then fetches:

```txt
https://cms.example.org/api/works/123/iiif/manifest
```

This is usually simpler than embedding OpenSeadragon directly inside the Strapi edit view.

If you do embed it in the Strapi admin, add a custom admin component and render `IiifManifestPreview` with the current work ID.

## 9. CORS Requirements

The browser must be allowed to fetch:

```txt
Strapi manifest route
Cantaloupe info.json URLs
Cantaloupe tile URLs
```

Allow the preview app origin in both Strapi and Cantaloupe.

Example origins:

```txt
http://localhost:3000
http://localhost:1337
https://frontend.example.org
https://cms.example.org
```

If CORS is wrong, the manifest may load but OpenSeadragon tiles will fail in the browser console.

## 10. Preview Checklist

Use this checklist when a preview does not work:

```txt
The Work has at least one related IIIF Asset.
The IIIF Asset has related IIIF Images.
Each IIIF Image has a cantaloupeIdentifier.
Each IIIF Image has width and height.
The manifest route returns JSON.
The manifest contains Canvas items.
Each Canvas body has an ImageService3 service.
Each service id resolves to a Cantaloupe info.json URL.
Cantaloupe can read the S3 object.
The browser can fetch Cantaloupe URLs without CORS errors.
```

## 11. Recommended First Milestone

Build the preview in this order:

1. Manually confirm one Cantaloupe `info.json` URL works.
2. Add the `IIIF Asset -> IIIF Image` relation if missing.
3. Add the Work manifest route.
4. Open the manifest route in the browser and inspect the JSON.
5. Build the OpenSeadragon preview component.
6. Add a Strapi admin preview button or external preview link.

This keeps failures isolated: first Cantaloupe, then Strapi manifest generation, then OpenSeadragon.
