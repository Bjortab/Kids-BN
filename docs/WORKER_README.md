# Cloudflare Worker - Audio Cache Service

## Overview

The `worker_get_audio.js` is a standalone Cloudflare Worker that serves cached audio files from Cloudflare R2 storage. This architecture improves CDN cache usage and reduces latency by separating the audio delivery from the TTS generation endpoint.

## Architecture

### Flow

1. **TTS Generation** (`/api/tts`):
   - Client requests TTS generation with text and voice parameters
   - Server checks R2 cache for existing audio
   - If cache miss, generates audio via Google TTS API
   - Stores generated audio in R2 with key `tts/{hash}.mp3`
   - Returns audio blob with `X-Audio-Key` header

2. **Audio Delivery** (`/api/get_audio`):
   - Client checks for `X-Audio-Key` header in TTS response
   - If present, fetches audio via `/api/get_audio?key=tts/{hash}.mp3`
   - Worker serves audio directly from R2 with aggressive CDN caching
   - Fallback: Client uses blob from TTS response directly

### Benefits

- **Improved CDN Caching**: Audio files served via GET requests are cached by Cloudflare's CDN
- **Reduced Latency**: Subsequent requests for the same audio are served from CDN edge locations
- **Cost Optimization**: Reduces R2 egress costs by leveraging CDN cache
- **Separation of Concerns**: TTS generation and audio delivery are decoupled

## Deployment

### Prerequisites

- Cloudflare account with Workers and R2 enabled
- `wrangler` CLI installed (`npm install -g wrangler`)
- R2 bucket `bn-audio` configured
- Environment variables configured in Cloudflare dashboard

### Manual Deployment

```bash
# Deploy the worker
wrangler deploy worker_get_audio.js \
  --name kids-bn-audio-worker \
  --compatibility-date 2024-10-06

# Bind R2 bucket (if not already configured)
# This is typically done via Cloudflare dashboard or wrangler.toml
```

### Automated Deployment

The worker is automatically deployed via GitHub Actions when:
- Changes are pushed to `main` branch and affect `worker_get_audio.js`
- Manual workflow dispatch is triggered

**Required GitHub Secrets:**
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with Workers and R2 permissions
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID

## Configuration

### R2 Binding

The worker requires the `BN_AUDIO` R2 binding:

```toml
[[r2_buckets]]
binding             = "BN_AUDIO"
bucket_name         = "bn-audio"
preview_bucket_name = "bn-audio"
```

### Environment Variables

- `BN_ALLOWED_ORIGIN`: CORS allowed origin (default: `*`)

## API Endpoints

### GET /api/get_audio

Retrieves cached audio from R2.

**Query Parameters:**
- `key` (required): R2 object key, e.g., `tts/abc123.mp3`

**Response Headers:**
- `Content-Type`: `audio/mpeg`
- `Cache-Control`: `public, max-age=31536000, immutable`
- `X-Audio-Source`: `r2-cache`

**Example:**
```bash
curl "https://your-worker.workers.dev/api/get_audio?key=tts/abc123.mp3"
```

**Response Codes:**
- `200`: Audio file found and returned
- `400`: Missing or invalid key parameter
- `404`: Audio file not found in R2
- `405`: Method not allowed (only GET supported)
- `500`: Internal server error

## Client Integration

The client (`public/app.js`) automatically uses the worker when available:

```javascript
// 1. Request TTS generation
const res = await fetch("/api/tts", {
  method: "POST",
  body: JSON.stringify({ text, voice })
});

// 2. Check for X-Audio-Key header
const audioKey = res.headers.get('X-Audio-Key');

// 3. If key present, fetch from worker for better caching
if (audioKey) {
  const audioRes = await fetch(`/api/get_audio?key=${encodeURIComponent(audioKey)}`);
  const blob = await audioRes.blob();
  const audioUrl = URL.createObjectURL(blob);
}

// 4. Fallback: use blob from TTS response directly
```

## Monitoring

### Metrics to Track

1. **Cache Hit Rate**: Percentage of requests served from CDN cache
2. **R2 Egress**: Data transferred from R2 to Worker
3. **Worker Invocations**: Total number of requests
4. **Error Rate**: Failed requests (4xx/5xx responses)

### Cloudflare Dashboard

- Navigate to Workers & Pages → kids-bn-audio-worker
- View real-time metrics and logs
- Check R2 analytics for storage usage

## Troubleshooting

### Audio Not Playing

1. Check browser console for errors
2. Verify `X-Audio-Key` header in TTS response
3. Test `/api/get_audio` endpoint directly
4. Check R2 bucket contains the audio file

### CORS Errors

- Ensure `BN_ALLOWED_ORIGIN` is configured correctly
- Verify origin header matches allowed origin
- Check browser network tab for preflight OPTIONS requests

### 404 Errors

- Audio file may not be cached yet (first request generates it)
- Verify key format matches `tts/{hash}.mp3`
- Check R2 bucket permissions

## Development

### Local Testing

```bash
# Install wrangler
npm install -g wrangler

# Run worker locally with wrangler dev
wrangler dev worker_get_audio.js
```

### Testing with curl

```bash
# Test OPTIONS (CORS preflight)
curl -X OPTIONS -i http://localhost:8787/api/get_audio

# Test GET with valid key
curl -i "http://localhost:8787/api/get_audio?key=tts/test123.mp3"

# Test GET without key (should return 400)
curl -i http://localhost:8787/api/get_audio
```

## Performance Considerations

- **CDN Cache**: Files are cached at edge locations for 1 year (`max-age=31536000`)
- **Immutable**: Cache is marked immutable, meaning it won't be revalidated
- **R2 Latency**: First request requires R2 fetch (~50-100ms), subsequent requests served from CDN (~5-10ms)

## Security

- **CORS**: Configurable origin restrictions
- **No Authentication**: Audio files are public once cached
- **Content Validation**: Only serves files from designated R2 bucket

## Future Enhancements

- [ ] Add authentication/authorization for private audio
- [ ] Implement rate limiting per IP
- [ ] Add audio transcoding for different formats
- [ ] Support range requests for audio streaming
- [ ] Add analytics and usage tracking
