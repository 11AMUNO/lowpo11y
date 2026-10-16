# 0004 — `AssetStorage` with private and public buckets

**Context.** Owner uploads must never be publicly readable before publishing.
Published thumbnails and downloads should be CDN-cacheable from a custom domain.
Development must work without Cloudflare.

**Decision.** `src/lib/storage` defines `AssetStorage` with two logical buckets:
- **private** — staging uploads, sources and all files of unpublished assets.
  Never publicly readable. Admin previews use short-lived signed GET URLs.
- **public** — copies of files belonging to published assets, served from the
  public base URL (R2 custom domain in production, `/files/...` locally).

Publishing copies an asset's published files into the public bucket;
unpublishing deletes those copies (originals remain in private storage).

Adapters: `LocalFilesystemStorage` (`.data/<env>/storage/{private,public}`,
signed upload/download tokens verified by our own route handlers) and
`R2Storage` (S3 API via `@aws-sdk/client-s3`, presigned PUT/GET). If only one
R2 bucket is configured, public files are served through short-lived signed
redirects from the private bucket instead (no CDN caching; documented in
`DEPLOYMENT.md`).

Object keys are built only by server code from immutable ids
(`assets/{assetId}/{purpose}/{fileId}.{ext}`, `staging/{uploadSessionId}/incoming`).
User-supplied paths are never used as keys.

Thumbnails and catalogue images are pre-generated derivatives (WebP), so pages
use plain `<img>` with explicit dimensions instead of `next/image`, avoiding
image-optimisation costs and keeping URLs CDN-friendly.

**Consequences.** Publishing duplicates bytes for published files (acceptable;
storage is cheap relative to egress). Bundle ZIPs are prebuilt at publish time,
not generated per request.
