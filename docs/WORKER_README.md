# Cloudflare Worker for Audio Serving

## Overview

The `worker_get_audio.js` worker provides a dedicated endpoint to serve cached audio files from Cloudflare R2 storage with optimal CDN caching.

## Purpose

- **Improved CDN Cache Usage**: By serving audio through a dedicated GET endpoint, Cloudflare's CDN can cache audio files more effectively
- **Better Performance**: Audio files are served with `Cache-Control: public, max-age=31536000, immutable` headers for maximum cache efficiency
- **Cost Optimization**: Reduces R2 egress costs by leveraging Cloudflare's CDN cache
- **Separation of Concerns**: Separates audio retrieval from the TTS generation logic

## Architecture

### Workflow

1. **TTS Generation** (`/api/tts`):
   - Client requests TTS generation with text and voice
   - Server generates audio (or retrieves from R2 cache)
   - Server returns audio blob with `X-Audio-Key` header containing the R2 key
   - Example: `X-Audio-Key: tts/abc123def456.mp3`

2. **Audio Serving** (`/api/get_audio`):
   - Client receives audio blob and `X-Audio-Key` header
   - For subsequent plays, client can use: `GET /api/get_audio?key=tts/abc123def456.mp3`
   - Worker fetches from R2 and serves with aggressive caching headers
   - Cloudflare CDN caches the audio, making subsequent requests extremely fast

### Benefits

- **First Play**: Audio is generated and returned immediately as blob
- **Subsequent Plays**: Audio is served from CDN cache (no R2 access needed)
- **Shared Caching**: Multiple users playing the same story benefit from cached audio
- **Immutable Content**: Audio files are content-addressed (SHA-256 hash), so they never change

## API Endpoints

### GET /api/get_audio

Retrieves cached audio from R2 storage.

**Query Parameters:**
- `key` (required): The R2 object key (e.g., `tts/abc123def456.mp3`)

**Response:**
- **200 OK**: Audio file with `Content-Type: audio/mpeg` and aggressive caching headers
- **400 Bad Request**: Missing key parameter
- **404 Not Found**: Audio file not found in R2
- **500 Internal Server Error**: Server error

**Example:**
```
GET /api/get_audio?key=tts/abc123def456.mp3
```

**Response Headers:**
```
Content-Type: audio/mpeg
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
```

## Client Implementation

The client (`public/app.js`) has been updated to:

1. Call `/api/tts` for audio generation
2. Extract `X-Audio-Key` header from response
3. Store the key for future use
4. On subsequent plays, optionally use `/api/get_audio?key=...` instead of regenerating

### Client Code Example

```javascript
// Generate audio
const res = await fetch("/api/tts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, voice })
});

// Get the R2 key for future use
const audioKey = res.headers.get('X-Audio-Key');
console.log('Audio cached at:', audioKey);

// Play the blob (first time)
const blob = await res.blob();
const url = URL.createObjectURL(blob);
audioElement.src = url;

// For future plays, could use:
// const cachedUrl = `/api/get_audio?key=${audioKey}`;
// audioElement.src = cachedUrl;
```

## Deployment

### Prerequisites

1. Cloudflare account with Workers enabled
2. R2 bucket named `bn-audio` configured
3. Secrets configured in Cloudflare:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

### Manual Deployment

```bash
# Install Wrangler CLI
npm install -g wrangler

# Authenticate with Cloudflare
wrangler login

# Deploy the worker
wrangler deploy worker_get_audio.js --name kids-bn-audio-worker
```

### Automated Deployment

The worker is automatically deployed via GitHub Actions when:
- Changes are pushed to `main` branch
- Files `worker_get_audio.js`, `wrangler.toml`, or the workflow file are modified
- Manual workflow dispatch is triggered

See `.github/workflows/deploy-worker.yml` for details.

## Configuration

The worker uses the following environment bindings from `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "BN_AUDIO"
bucket_name = "bn-audio"
preview_bucket_name = "bn-audio"

[vars]
BN_ALLOWED_ORIGIN = "https://kids-bn.pages.dev"
```

## CORS Configuration

The worker supports CORS for cross-origin requests:
- **Allowed Origins**: Configured via `BN_ALLOWED_ORIGIN` or wildcard `*`
- **Allowed Methods**: `GET, OPTIONS`
- **Allowed Headers**: `Content-Type`

## Caching Strategy

### Cache Headers
```
Cache-Control: public, max-age=31536000, immutable
```

- `public`: Can be cached by any cache (CDN, browser)
- `max-age=31536000`: Cache for 1 year (365 days)
- `immutable`: Content never changes (content-addressed)

### Cache Benefits

1. **CDN Edge Cache**: Cloudflare caches at edge locations globally
2. **Browser Cache**: Browsers cache locally for instant playback
3. **R2 Cost Reduction**: Cached responses don't hit R2 storage
4. **Performance**: Sub-10ms response times from edge cache

## Monitoring

Monitor the worker in Cloudflare dashboard:
- **Analytics**: Request count, cache hit ratio, response time
- **Logs**: Real-time logs via `wrangler tail`
- **Metrics**: Error rates, status code distribution

```bash
# View real-time logs
wrangler tail kids-bn-audio-worker
```

## Troubleshooting

### 404 Not Found
- Audio file not in R2 storage
- Check that `/api/tts` successfully stored the file
- Verify R2 bucket binding is correct

### 500 Internal Server Error
- Check R2 bucket binding configuration
- Verify worker has access to R2 bucket
- Check Cloudflare dashboard for error logs

### CORS Issues
- Verify `BN_ALLOWED_ORIGIN` is set correctly
- Check that client origin matches allowed origin
- Use wildcard `*` for development (not recommended for production)

## Future Enhancements

- Add request rate limiting
- Implement audio file format conversion (MP3, OGG, WebM)
- Add analytics for popular audio files
- Implement audio file expiration/cleanup for old files
