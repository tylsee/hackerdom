/**
 * Real API smoke tests with synthetic image data only; never sends a job's
 * screenshots, videos, bearer token, or private metadata.
 * Run from backend root: node scripts/diagnose-gemini.js
 * Each successful stage makes one Gemini API call and may use quota.
 */
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { loadConfig } from '../src/config/env.js';
import { createGeminiAnalyzer } from '../src/services/gemini-analyzer.js';
import { validateAnalysis } from '../src/schemas/analysis.js';

const config = loadConfig();
if (!config.geminiApiKey) {
  console.error('GEMINI_NOT_CONFIGURED: add GEMINI_API_KEY to .env and restart.');
  process.exitCode = 1;
} else {
  const model = config.geminiModel;
  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  function safeError(error) {
    // Only diagnostic requests using synthetic text/images are sent here.
    const message = String(error?.message ?? 'No provider message')
      .replaceAll(config.geminiApiKey, '[REDACTED_API_KEY]')
      .replace(/AIza[\w-]+/g, '[REDACTED_API_KEY]')
      .replace(/key=[^&\s]+/gi, 'key=[REDACTED]')
      .slice(0, 900);
    return {
      status: error?.status ?? error?.statusCode ?? null,
      type: error?.name ?? 'Error',
      code: error?.code ?? null,
      message,
    };
  }
  console.log(`Model: ${model}`);
  try {
    const response = await client.models.generateContent({
      model, contents: 'Reply with exactly OK.',
      config: { httpOptions: { timeout: 30_000 } },
    });
    console.log('TEST 1 (model + API key): PASS; response received:', Boolean(response.text));
  } catch (error) {
    console.log('TEST 1 (model + API key): FAILED', safeError(error));
    process.exitCode = 1;
  }
  if (!process.exitCode) {
    const evidenceId = randomUUID();
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260">
      <rect width="600" height="260" fill="#ffffff"/>
      <text x="20" y="45" font-size="23">Sample order register</text>
      <text x="20" y="100" font-size="18">Order ID | Item | Quantity</text>
      <text x="20" y="145" font-size="18">A001 | Pencil | 5</text>
      </svg>`);
    const pixels = await sharp(svg).png().toBuffer();
    const evidence = [{ id: evidenceId, order: 1, timestampMs: 0, data: pixels }];
    const job = {
      preferences: { inputType: 'video', writingTone: 'professional', documentType: 'sop' },
      metadata: {
        title: 'Synthetic test', processDescription: null, intendedAudience: null,
        additionalContext: null,
      },
    };
    // Isolate whether image inputs work at all before blaming the JSON schema.
    try {
      const visual = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [
          { text: 'Describe this synthetic spreadsheet in one short sentence.' },
          { inlineData: { mimeType: 'image/png', data: pixels.toString('base64') } },
        ] }],
        config: { httpOptions: { timeout: 30_000 } },
      });
      console.log('TEST 2A (image input, no output schema): PASS; response received:', Boolean(visual.text));
    } catch (error) {
      console.log('TEST 2A (image input, no output schema): FAILED', safeError(error));
      process.exitCode = 1;
    }
    if (!process.exitCode) {
      let usedFallback = false;
      try {
        const analyzer = createGeminiAnalyzer({ apiKey: config.geminiApiKey, model,
          onSchemaFallback: () => { usedFallback = true; } });
        const result = await analyzer.analyze({ job, evidence });
        console.log('TEST 2B (image + JSON analysis): PASS; steps returned:', result.steps?.length ?? 0,
          '; schema fallback used:', usedFallback);
        try {
          const checked = validateAnalysis(result, evidence, 'video', 120_000);
          console.log('TEST 3 (DocuAI evidence validation): PASS; steps validated:', checked.length);
        } catch (error) {
          console.log('TEST 3 (DocuAI evidence validation): FAILED', safeError(error));
          process.exitCode = 1;
        }
      } catch (error) {
        console.log('TEST 2B (image + JSON analysis): FAILED', safeError(error),
          '; schema fallback used:', usedFallback);
        process.exitCode = 1;
      }
    }
  }
}
