/**
 * Central configuration for API keys
 * All keys must come from environment variables - NO HARDCODED VALUES
 * 
 * To set up your API keys:
 * 1. Create a .env file in the backend directory
 * 2. Add the keys below (see .env.example for template)
 * 3. Never commit .env to version control
 */

require('dotenv').config();

// Guardian API - Required for Guardian articles
const GUARDIAN_API_KEY = process.env.GUARDIAN_API_KEY;
if (!GUARDIAN_API_KEY) {
  console.warn('[CONFIG] GUARDIAN_API_KEY not set - Guardian articles will not be available');
  console.warn('   Get your key at: https://open-platform.theguardian.com/access/');
}

// GDELT API - Optional (free tier doesn't require key, but can be set)
const GDELT_API_KEY = process.env.GDELT_API_KEY;
if (!GDELT_API_KEY) {
  console.log('[CONFIG] GDELT_API_KEY not set - Using free tier (no key required)');
  console.log('   GDELT free tier: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/');
}

// Currents API - Required for Currents articles
const CURRENTS_API_KEY = process.env.CURRENTS_API_KEY;
if (!CURRENTS_API_KEY) {
  console.warn('[CONFIG] CURRENTS_API_KEY not set - Currents articles will not be available');
  console.warn('   Get your key at: https://currentsapi.services/ (free tier available)');
}

// LLM API - Required for summaries
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
const LLM_API_URL = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-3.5-turbo';

if (!OPENAI_API_KEY) {
  console.warn('[CONFIG] OPENAI_API_KEY or LLM_API_KEY not set - LLM summaries will use fallback');
  console.warn('   Get your key at: https://platform.openai.com/api-keys');
  console.warn('   Or set LLM_API_URL to point to your own LLM endpoint');
}

// Log configuration status on startup
console.log('\n[CONFIG] API Configuration Status:');
console.log(`   Guardian: ${GUARDIAN_API_KEY ? 'Configured' : 'Missing'}`);
console.log(`   GDELT: ${GDELT_API_KEY ? 'Configured (optional)' : 'Using free tier'}`);
console.log(`   Currents: ${CURRENTS_API_KEY ? 'Configured' : 'Missing'}`);
console.log(`   LLM: ${OPENAI_API_KEY ? 'Configured' : 'Missing (will use fallback)'}\n`);

module.exports = {
  GUARDIAN_API_KEY,
  GDELT_API_KEY,
  CURRENTS_API_KEY,
  OPENAI_API_KEY,
  LLM_API_URL,
  LLM_MODEL
};

