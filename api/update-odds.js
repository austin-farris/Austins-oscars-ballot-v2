// This serverless function fetches live odds from Polymarket
// and updates your Supabase database
// It runs on a schedule (cron) or can be called manually

import { createClient } from '@supabase/supabase-js';

// Mapping of Polymarket market titles to our nominee IDs
const NOMINEE_MAPPING = {
  "one battle after another": 1,
  "hamnet": 2,
  "sinners": 3,
  "marty supreme": 4,
  "sentimental value": 5,
  "the secret agent": 6,
  "frankenstein": 7,
  "bugonia": 8,
  "f1": 9,
  "f1: the movie": 9,
  "train dreams": 10,
};

export default async function handler(req, res) {
  // Only allow GET and POST requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    );

    // Fetch Oscar Best Picture markets from Polymarket's Gamma API
    const polymarketResponse = await fetch(
      'https://gamma-api.polymarket.com/events?slug=oscars-2026-best-picture-winner&active=true'
    );

    if (!polymarketResponse.ok) {
      throw new Error(`Polymarket API error: ${polymarketResponse.status}`);
    }

    const events = await polymarketResponse.json();
    
    if (!events || events.length === 0) {
      return res.status(404).json({ error: 'Oscar Best Picture market not found' });
    }

    const event = events[0];
    const markets = event.markets || [];
    
    const updates = [];
    const updatedOdds = [];

    for (const market of markets) {
      // Parse the outcome prices
      const outcomes = JSON.parse(market.outcomes || '[]');
      const prices = JSON.parse(market.outcomePrices || '[]');
      
      // Find the "Yes" price (probability the movie wins)
      const yesIndex = outcomes.findIndex(o => o.toLowerCase() === 'yes');
      if (yesIndex === -1) continue;
      
      const probability = parseFloat(prices[yesIndex]);
      if (isNaN(probability)) continue;

      // Match the market question to our nominee
      const question = (market.question || '').toLowerCase();
      
      for (const [filmName, nomineeId] of Object.entries(NOMINEE_MAPPING)) {
        if (question.includes(filmName)) {
          updates.push({
            nominee_id: nomineeId,
            odds: probability,
          });
          updatedOdds.push({
            film: filmName,
            nominee_id: nomineeId,
            odds: probability,
            percent: (probability * 100).toFixed(1) + '%'
          });
          break;
        }
      }
    }

    // Update Supabase with new odds
    if (updates.length > 0) {
      for (const update of updates) {
        const { error } = await supabase
          .from('odds')
          .upsert(update, { onConflict: 'nominee_id' });
        
        if (error) {
          console.error(`Error updating odds for nominee ${update.nominee_id}:`, error);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Updated ${updates.length} odds from Polymarket`,
      timestamp: new Date().toISOString(),
      odds: updatedOdds,
    });

  } catch (error) {
    console.error('Error fetching Polymarket odds:', error);
    return res.status(500).json({
      error: 'Failed to fetch odds',
      message: error.message,
    });
  }
}
