#!/usr/bin/env node
// listmode.js (Fixed with REST API)
// ---------------------------------------------------------------
// Lists all Gemini models via direct API call (works with @google/generative-ai)
// Usage: npm i axios dotenv
//         node listmode.js
// ---------------------------------------------------------------

require('dotenv').config();
const axios = require('axios');

// ----------------------------------------------------------------
// 1. API Setup
// ----------------------------------------------------------------
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY missing in .env');
  process.exit(1);
}

const API_KEY = process.env.GEMINI_API_KEY;
const LIST_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// ----------------------------------------------------------------
// 2. Pretty-print a model
// ----------------------------------------------------------------
function printModel(model, index) {
  const {
    name,
    displayName,
    description,
    inputTokenLimit,
    outputTokenLimit,
    supportedGenerationMethods
  } = model;

  const supportsGenerate = supportedGenerationMethods?.includes('generateContent') ?? false;
  if (!supportsGenerate) return; // Filter for chat-capable models only

  console.log(`${index}. **${displayName || name.split('/')[1].replace(/-/g, ' ')}**`);
  console.log(`   API Name: ${name}`);
  console.log(`   Tokens: In=${inputTokenLimit?.toLocaleString() ?? '—'} | Out=${outputTokenLimit?.toLocaleString() ?? '—'}`);
  console.log(`   Methods: ${supportedGenerationMethods?.join(', ') ?? '—'}`);
  console.log(`   Desc: ${description?.slice(0, 100)}${description?.length > 100 ? '…' : ''}\n`);
}

// ----------------------------------------------------------------
// 3. Fetch & List Models
// ----------------------------------------------------------------
(async () => {
  try {
    console.log('🔍 Fetching Gemini models via REST API…\n');
    
    const response = await axios.get(LIST_MODELS_URL, {
      params: { key: API_KEY }
    });

    const models = response.data.models || [];
    const chatModels = models.filter(m => m.supportedGenerationMethods?.includes('generateContent'));

    if (chatModels.length === 0) {
      console.log('❌ No chat models found. Check API key or enable Generative Language API.');
      console.log('Models returned:', models.length);
      return;
    }

    console.log(`✅ ${chatModels.length} chat-capable models available:\n`);
    chatModels.forEach((model, i) => printModel(model, i + 1));
    
    console.log('\n💡 Use in your bot: `model: \'${name}\'` (e.g., \'gemini-1.5-flash\')');
    console.log('🔧 API Version: v1beta (for 1.5+ models, try v1 in your code).');

  } catch (err) {
    if (err.response?.status === 401) {
      console.error('❌ Invalid API key. Get a new one from https://aistudio.google.com/app/apikey');
    } else if (err.response?.status === 403) {
      console.error('❌ API not enabled. Enable "Generative Language API" in Google Cloud Console.');
    } else {
      console.error('❌ Failed to list models:', err.message);
    }
  }
})();
