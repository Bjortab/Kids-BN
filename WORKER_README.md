# Cloudflare Worker for Audio Serving

## Overview

This implementation adds a Cloudflare Worker to serve audio files from R2 storage (BN_AUDIO bucket) with edge caching. This improves performance and reduces costs by caching audio files at Cloudflare's edge network.

## Components

### 1. Cloudflare Worker (`worker_get_audio.js`)

The worker handles GET requests to `/api/get_audio?key=<audio-key>` and:
- Fetches audio files from R2 (BN_AUDIO bucket)
- Implements edge caching using Cloudflare's Cache API
- Returns proper CORS headers for cross-origin requests
- Sets aggressive cache headers (1 year) for immutable audio files
- Provides cache hit/miss status in response headers for debugging

**Key Features:**
- Edge caching reduces origin requests and bandwidth costs
- Supports CORS for cross-origin audio playback
- Graceful error handling with appropriate HTTP status codes
- Cache-Control headers ensure browser and CDN caching

### 2. Client Updates (`public/app.js`)

The client-side playTTS function has been updated to:
- Check for `X-Audio-Key` header in TTS API responses
- Use cacheable endpoint (`/api/get_audio?key=...`) when key is available
- Fall back to blob URLs for backward compatibility
- Add logging for debugging and monitoring

**Benefits:**
- Browser can cache audio files across page loads
- CDN can cache and serve audio without hitting origin
- Reduces bandwidth and API costs
- Improves audio playback performance

### 3. Wrangler Configuration (`wrangler_worker.toml`)

Dedicated configuration for the worker deployment:
- Defines worker name and entry point
- Configures R2 bucket binding
- Sets environment variables
- Configures compatibility date

### 4. CI/CD Workflow (`.github/workflows/deploy-worker.yml`)

Automated deployment workflow that:
- Triggers on changes to worker files or manual dispatch
- Installs wrangler CLI
- Deploys the worker to Cloudflare
- Uses secrets for authentication

## Deployment

### Prerequisites

1. **Cloudflare Account**: You need a Cloudflare account with Workers and R2 enabled
2. **GitHub Secrets**: Set the following secrets in your GitHub repository:
   - `CLOUDFLARE_API_TOKEN`: API token with Workers and R2 permissions
   - `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID

### Manual Deployment

```bash
# Install wrangler globally
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy the worker
wrangler deploy --config wrangler_worker.toml
```

### Automatic Deployment

The worker is automatically deployed when:
- Changes are pushed to the `main` branch that affect worker files
- The workflow is manually triggered from GitHub Actions

## Configuration

### Worker Route Setup

After deploying the worker, you need to configure routes in the Cloudflare dashboard:

1. Go to your Cloudflare Workers dashboard
2. Navigate to your worker (`kids-bn-audio-worker`)
3. Add a route pattern: `kids-bn.pages.dev/api/get_audio` (or your domain)
4. Save the route configuration

Alternatively, use the Cloudflare API or wrangler to configure routes programmatically.

### Environment Variables

The worker uses the following environment variables (configured in `wrangler_worker.toml`):
- `BN_ALLOWED_ORIGIN`: CORS allowed origin (default: `https://kids-bn.pages.dev`)

### R2 Bucket Binding

The worker requires access to the `BN_AUDIO` R2 bucket:
- Binding name: `BN_AUDIO`
- Production bucket: `bn-audio`
- Preview bucket: `bn-audio`

## Usage

### API Endpoint

```
GET /api/get_audio?key=<audio-key>
```

**Parameters:**
- `key` (required): R2 object key (e.g., `tts/abc123.mp3`)

**Response:**
- Status: 200 OK (on success)
- Content-Type: `audio/mpeg` (or from R2 metadata)
- Cache-Control: `public, max-age=31536000, immutable`
- X-Cache-Status: `HIT` or `MISS` (for debugging)
- X-Audio-Key: The requested key (for debugging)

**Example:**
```javascript
// Client-side usage
const audioKey = response.headers.get('X-Audio-Key');
const audioUrl = `/api/get_audio?key=${encodeURIComponent(audioKey)}`;
audioElement.src = audioUrl;
```

## Architecture

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ 1. POST /api/tts
       │    (generate audio)
       ▼
┌─────────────────┐
│   Pages API     │
│  /api/tts       │  Returns X-Audio-Key header
└──────┬──────────┘
       │
       │ 2. GET /api/get_audio?key=...
       ▼
┌─────────────────┐     ┌─────────────┐
│ Cloudflare      │────▶│  R2 Bucket  │
│ Worker          │     │  (BN_AUDIO) │
│ (Edge Cache)    │◀────┤             │
└─────────────────┘     └─────────────┘
       │
       │ 3. Audio stream + cache headers
       ▼
┌─────────────┐
│   Client    │
│  (Browser)  │
└─────────────┘
```

## Benefits

1. **Reduced Costs**:
   - Edge caching reduces R2 bandwidth costs
   - Fewer origin requests reduce function invocations
   - Browser caching reduces overall requests

2. **Improved Performance**:
   - Edge cache serves audio faster than origin
   - Browser cache enables instant playback for repeated audio
   - Reduced latency for end users

3. **Scalability**:
   - Cloudflare's edge network handles traffic spikes
   - No origin overload during high traffic
   - Global distribution for worldwide users

4. **Reliability**:
   - Edge cache continues serving even if origin is slow
   - Reduced dependency on origin availability
   - Better user experience during high load

## Monitoring

Check the following for monitoring:
- Worker metrics in Cloudflare dashboard
- X-Cache-Status header in responses (HIT/MISS)
- Browser console logs for debugging
- R2 bucket metrics for bandwidth and requests

## Troubleshooting

### Worker not receiving requests
- Verify route configuration in Cloudflare dashboard
- Check that the route pattern matches your domain
- Ensure the worker is deployed and active

### Audio files not found (404)
- Verify the key exists in R2 bucket
- Check R2 bucket binding is correct
- Ensure the key format matches (e.g., `tts/abc123.mp3`)

### CORS errors
- Verify `BN_ALLOWED_ORIGIN` matches your domain
- Check browser console for specific CORS errors
- Ensure OPTIONS requests return 204

### Cache not working
- Check Cache-Control headers in response
- Verify cache API is being used correctly
- Check browser cache in DevTools Network tab

## Future Improvements

Possible enhancements:
1. Add request rate limiting to prevent abuse
2. Implement cache purging API for updates
3. Add metrics and logging integration
4. Support for additional audio formats
5. Implement signed URLs for private audio
6. Add CDN analytics and reporting
