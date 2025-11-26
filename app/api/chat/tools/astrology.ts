// app/api/chat/tools/astrology.ts

import { tool } from 'ai';
import { z } from 'zod';

// Base URL for AstrologyAPI JSON endpoints
const ASTROLOGY_BASE_URL = 'https://json.astrologyapi.com/v1';

// --- Small helper to build Basic Auth header ---
function getAuthHeader() {
  const userId = process.env.ASTROLOGY_API_USER_ID;
  const apiKey = process.env.ASTROLOGY_API_KEY;

  if (!userId || !apiKey) {
    throw new Error(
      'Astrology API credentials missing. Set ASTROLOGY_API_USER_ID and ASTROLOGY_API_KEY in env.'
    );
  }

  const token = Buffer.from(`${userId}:${apiKey}`).toString('base64');
  return 'Basic ' + token;
}

// --- Generic POST helper for AstrologyAPI ---
async function callAstrologyApi(endpoint: string, body: unknown) {
  const res = await fetch(`${ASTROLOGY_BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: getAuthHeader(), // NOTE: lowercase "authorization" as per docs
      'Content-Type': 'application/json',
      'Accept-Language': 'en',
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();

  if (!res.ok) {
    // This will be returned to the model; keep it readable
    throw new Error(`AstrologyAPI ${endpoint} ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * ZodiAI astrology tool
 *
 * 1. Takes name + birth details + place string.
 * 2. Uses geo_details to get lat/lon/timezone_id.
 * 3. Uses timezone_with_dst to get numeric timezone offset.
 * 4. Calls either:
 *    - astro_details (for birth chart themes), OR
 *    - daily_nakshatra_prediction (for today’s guidance).
 * 5. Returns a compact JSON object for the LLM to interpret.
 */
export const astrologyTool = tool(
  {
    description:
      'Use this to fetch Vedic astrology data for a user based on their birth details and place of birth.',

    // Make sure the name "inputSchema" matches your other tools (like web-search.ts)
    inputSchema: z.object({
      queryType: z
        .enum(['birth_details', 'daily_nakshatra_prediction'])
        .describe(
          'Use "birth_details" for birth chart / life themes; "daily_nakshatra_prediction" for today/near-term guidance.'
        ),

      name: z.string().describe('Full name of the user.'),

      day: z.number().int().min(1).max(31).describe('Day of birth'),
      month: z.number().int().min(1).max(12).describe('Month of birth (1–12)'),
      year: z.number().int().min(1900).max(2100).describe('Year of birth'),

      hour: z
        .number()
        .int()
        .min(0)
        .max(23)
        .describe('Hour of birth in 24h format (0–23). If unknown, approximate.'),

      minute: z
        .number()
        .int()
        .min(0)
        .max(59)
        .describe('Minute of birth (0–59). If unknown, approximate.'),

      place: z
        .string()
        .describe(
          'City or town of birth, e.g. "Mumbai" or "Junagadh". Prefer just the city name; country is optional.'
        ),
    }),
  },

  // SECOND ARGUMENT: execute function (do NOT put execute: inside the object)
  async (input) => {
    const { name, day, month, year, hour, minute, place, queryType } = input;

    // 1) GEO LOOKUP: geo_details → lat, lon, timezone_id
    let geoResp: any;
    try {
      geoResp = await callAstrologyApi('geo_details', {
        place: place.trim(),
        maxRows: 3,
      });
    } catch (err: any) {
      return {
        type: 'error',
        step: 'geo_details',
        message:
          'Failed to contact astrology geo service. This is likely an API / credentials issue, not the city name.',
        technical: err?.message ?? String(err),
      };
    }

    const geonames = geoResp?.geonames;
    if (!Array.isArray(geonames) || geonames.length === 0) {
      return {
        type: 'location_not_found',
        message: `Astrology provider could not find a match for "${place}". Ask the user to try the nearest bigger city (e.g. "Rajkot", "Ahmedabad", "Mumbai").`,
      };
    }

    const location = geonames[0];
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    const resolvedPlace =
      location.place_name || `${place.trim()} (${location.country_code || 'unknown'})`;

    // 2) TIMEZONE: timezone_with_dst → timezone (e.g. 5.5)
    let timezone = 5.5; // safe default for India
    try {
      const tzResp: any = await callAstrologyApi('timezone_with_dst', {
        latitude,
        longitude,
        date: `${month}-${day}-${year}`, // "mm-dd-yyyy"
      });

      if (typeof tzResp?.timezone === 'number') {
        timezone = tzResp.timezone;
      }
    } catch {
      // If this fails, keep default 5.5 – better than crashing
    }

    // 3) MAIN ASTROLOGY CALL
    if (queryType === 'birth_details') {
      // Birth chart basics
      const astro = await callAstrologyApi('astro_details', {
        day,
        month,
        year,
        hour,
        min: minute,
        lat: latitude,
        lon: longitude,
        tzone: timezone,
      });

      return {
        type: 'birth_details',
        name,
        place: resolvedPlace,
        latitude,
        longitude,
        timezone,
        raw: astro,
      };
    }

    if (queryType === 'daily_nakshatra_prediction') {
      const prediction = await callAstrologyApi('daily_nakshatra_prediction', {
        day,
        month,
        year,
        hour,
        min: minute,
        lat: latitude,
        lon: longitude,
        tzone: timezone,
      });

      return {
        type: 'daily_nakshatra_prediction',
        name,
        place: resolvedPlace,
        latitude,
        longitude,
        timezone,
        raw: prediction,
      };
    }

    // Fallback – should never happen if the model respects the schema
    return {
      type: 'error',
      step: 'queryType',
      message:
        'Unsupported queryType in astrologyTool. Use "birth_details" or "daily_nakshatra_prediction".',
    };
  }
);
