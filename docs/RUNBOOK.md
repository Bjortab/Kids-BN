# RUNBOOK — Deploy and wiring instructions

This document explains how to wire the generated code into your environment and deploy.

1) Files added in PR:
   - src/storyTemplates.js
   - src/generate_story_handler.js
   - src/tts_chunk_and_r2_helper.js
   - docs/CHANGELOG.md
   - docs/RUNBOOK.md

2) Environment variables (set in GitHub Secrets -> Actions):
   - OPENAI_API_KEY = <your OpenAI API key>
   - OPENAI_MODEL = (optional, default gpt-4o-mini)
   - CF_ACCOUNT_ID = <Cloudflare account id> (if using R2 upload via CF)
   - CF_API_TOKEN = <Cloudflare API token with Workers:Edit + R2:Write>

3) Cloudflare R2 binding
   - Create R2 bucket named `bn-audio` (if not exists).
   - In Cloudflare Workers dashboard -> your Worker -> Bindings -> Add binding -> type R2 bucket -> Name = R2 (or BN_AUDIO) -> Bucket = bn-audio.
   - NOTE: If using wrangler and GitHub Actions, ensure wrangler.toml includes an [env.production] r2 binding.

4) TTS service
   - Implement ttsGenerateFunction wrapper to call your TTS provider. Ensure it returns binary audio (mp3) data.
   - Use createTTSAndStore with an r2PutFunction that uploads to R2 (AWS S3 style or Cloudflare SDK).

5) Deploy
   - Create branch add-story-templates, open PR, review, merge to main.
   - If you have GitHub Actions to publish Workers, merge will trigger deploy. Otherwise use wrangler publish.

6) Testing
   - Call POST /api/generate_story with body { ageRange: '11-12', prompt: '...' } and verify result contains story and imagePrompts.
   - For long stories, check chunksCount and that createTTSAndStore uploads keys to R2.

7) Rollback
   - Use git tags and CHANGELOG.md entries to find previous versions. Checkout tag or revert PR if required.

--- End of RUNBOOK ---
