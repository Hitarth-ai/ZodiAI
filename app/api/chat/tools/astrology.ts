// app/api/chat/tools/astrology.ts

import { tool } from 'ai';
import { z } from 'zod';

const ASTROLOGY_BASE_URL = 'https://json.astrologyapi.com/v1';

function getAuthHeader() {
  const userId = process.env.ASTROLOGY_API_USER_ID;
  const apiKey = process.env.ASTROLOGY_API_KEY;

  if (!userId || !apiKey) {
    throw new Error(
      'Astrology API credentials are missing. Set ASTROLOGY_API_USER_ID and ASTROLOGY_API_KEY in .env.local'
    );
  }

  const token = Buffer.from(`${userId}:${apiKey}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Generic helper to call AstrologyAPI endpoints.
 */
async function callAstrologyApi(endpoint: string, body: unknown) {
  const res = await fetch(`${ASTROLOGY_BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept-Language': 'en',
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AstrologyAPI error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * ZodiAI astrology tool:
 *  - Takes structured birth details + place name
 *  - Internally calls:
 *    1) geo_details → lat/lon/timezone_id
 *    2) timezone_with_dst → numeric timezone offset
 *    3) either birth_details or daily_nakshatra_prediction
 *  - Returns a compact JSON structure for the model to interpret.
 */
export const astrologyTool = tool({
  description:
    'Get personalised Vedic astrology insights using user birth details (DOB, time, place).',

  parameters: z.object({
    queryType: z
      .enum(['birth_details', 'daily_nakshatra_prediction'])
      .describe(
        'Use "birth_details" for natal chart / life themes; use "daily_nakshatra_prediction" for today / short-term guidance.'
      ),

    name: z.string().describe('Full name of the person.'),

    day: z.number().int().min(1).max(31).describe('Day of birth'),
    month: z.number().int().min(1).max(12).describe('Month of birth (1-12)'),
    year: z.number().int().min(1900).max(2100).describe('Year of birth'),

    hour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe('Hour of birth in 24h format (0-23). If unknown, use 12.'),

    minute: z
      .number()
      .int()
      .min(0)
      .max(59)
      .describe('Minute of birth (0-59). If unknown, use 0.'),

    place: z
      .string()
      .describe('City and country of birth, e.g. "Mumbai, India".'),
  }),

  /**
   * The AI SDK will call this when the model chooses this tool.
   */
  execute: async (input) => {
    const { name, day, month, year, hour, minute, place, queryType } = input;

    // 1) Lookup location (lat/lon + timezone_id)
    const geoResp = await callAstrologyApi('geo_details', {
      place,
      maxRows: 1,
    });

    if (!geoResp?.geonames?.length) {
      return {
        type: 'error',
        message: `Could not find location "${place}". Ask the user to try nearest major city.`,
      };
    }

    const location = geoResp.geonames[0];
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);

    // 2) Lookup timezone offset for the given date
    const tzResp = await callAstrologyApi('timezone_with_dst', {
      latitude,
      longitude,
      // mm-dd-yyyy as per docs
      date: `${month}-${day}-${year}`,
    });

    const tzone =
      typeof tzResp?.timezone === 'number' ? tzResp.timezone : 5.5; // fallback for safety

    // 3) Main astrology endpoint
    if (queryType === 'birth_details') {
      const birth = await callAstrologyApi('birth_details', {
        day,
        month,
        year,
        hour,
        min: minute,
        lat: latitude,
        lon: longitude,
        tzone,
      });

      return {
        type: 'birth_details',
        name,
        location,
        timezone: tzone,
        rawBirth: birth,
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
        tzone,
      });

      return {
        type: 'daily_nakshatra_prediction',
        name,
        location,
        timezone: tzone,
        rawPrediction: prediction,
      };
    }

    return {
      type: 'error',
      message: 'Unsupported queryType. Use birth_details or daily_nakshatra_prediction.',
    };
  },
});
