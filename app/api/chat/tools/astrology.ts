// app/api/chat/tools/astrology.ts

import { tool } from "ai";
import { z } from "zod";

const ASTROLOGY_API_BASE = "https://json.astrologyapi.com/v1";

const ASTROLOGY_USER_ID = process.env.ASTROLOGY_USER_ID;
const ASTROLOGY_API_KEY = process.env.ASTROLOGY_API_KEY;

// Helpful log in case env vars are missing at build time
if (!ASTROLOGY_USER_ID || !ASTROLOGY_API_KEY) {
  console.warn(
    "[astrologyTool] ASTROLOGY_USER_ID or ASTROLOGY_API_KEY is missing. " +
      "Set them in .env.local"
  );
}

// Build the Basic Auth header for AstrologyAPI, compatible with Node + Edge
function buildAuthHeader(): string {
  if (!ASTROLOGY_USER_ID || !ASTROLOGY_API_KEY) {
    throw new Error(
      "Astrology API credentials are not configured on the server."
    );
  }

  const authString = `${ASTROLOGY_USER_ID}:${ASTROLOGY_API_KEY}`;
  let base64: string;

  // Node.js (Buffer exists)
  if (typeof (globalThis as any).Buffer !== "undefined") {
    base64 = (globalThis as any)
      .Buffer.from(authString, "utf8")
      .toString("base64");
  } else {
    // Edge / browser-like runtimes
    base64 = btoa(authString);
  }

  return `Basic ${base64}`;
}

// ------------------------
// Types for responses
// ------------------------

type GeoDetailsResult = {
  geonames?: {
    place_name: string;
    latitude: number | string;
    longitude: number | string;
    timezone_id: string;
    country_code: string;
  }[];
};

type TimezoneResult = {
  timezone: string | number;
};

// Generic POST helper to AstrologyAPI
async function astrologyPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ASTROLOGY_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: buildAuthHeader(),
      "Accept-Language": "en",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AstrologyAPI ${path} error ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

// ------------------------
// MAIN TOOL DEFINITION
// ------------------------

export const astrologyTool = tool({
  description: `
Use the Indian Astrology API to answer user questions about their horoscope, birth chart and life trends.
The tool automatically resolves the user's birth place into latitude, longitude and timezone.
Call this whenever the user gives (or is ready to give) birth date, birth time and place.`,
  inputSchema: z.object({
    name: z.string().describe("Name of the person."),
    day: z.number().int().min(1).max(31).describe("Day of birth."),
    month: z.number().int().min(1).max(12).describe("Month of birth (1–12)."),
    year: z.number().int().min(1900).max(2100).describe("Year of birth."),
    hour: z.number().int().min(0).max(23).describe("Hour of birth (0–23)."),
    minute: z.number().int().min(0).max(59).describe("Minute of birth (0–59)."),
    place: z
      .string()
      .describe(
        "Birth place (city or town, e.g. 'Mumbai' or 'Junagadh, India')."
      ),
    queryType: z
      .enum(["birth_chart", "general_report"])
      .describe(
        "What the user is asking for: 'birth_chart' or a high-level 'general_report'."
      ),
  }),

  /**
   * The AI SDK will call this when the model chooses this tool.
   */
  execute: async (input) => {
    const { name, day, month, year, hour, minute, place, queryType } = input;

    // 1) GEO LOOKUP – resolve the place name
    //    - We strip off anything after a comma so both "Mumbai" and "Mumbai, India" work.
    const trimmedPlace = place.split(",")[0].trim();

    let geo: GeoDetailsResult;
    try {
      geo = await astrologyPost<GeoDetailsResult>("geo_details", {
        place: trimmedPlace.toLowerCase(),
        maxRows: 3,
      });
    } catch (error) {
      console.error("[astrologyTool] geo_details error", error);
      return {
        type: "astrology-error",
        message: `I couldn't reach the astrology location service for "${place}". Please try again in a bit or give me the nearest big city.`,
      };
    }

    const candidate = geo.geonames && geo.geonames[0];

    if (!candidate) {
      return {
        type: "astrology-error",
        message: `The astrology service could not recognise "${place}". Try a nearby major city, like Mumbai, Delhi, London, etc.`,
      };
    }

    const latitude = Number(candidate.latitude);
    const longitude = Number(candidate.longitude);
    const timezoneId = candidate.timezone_id;
    const countryCode = candidate.country_code;

    // 2) TIMEZONE LOOKUP – convert timezone_id → numeric offset (tzone)
    //    Docs use 'country_code' for the field name but description says "time zone id".
    let tzone = 5.5; // default to IST if anything fails
    try {
      const tz = await astrologyPost<TimezoneResult>("timezone", {
        country_code: timezoneId, // actually timezone_id
        isDst: false,
      });
      const parsed = Number(tz.timezone);
      if (!Number.isNaN(parsed)) {
        tzone = parsed;
      }
    } catch (error) {
      console.error("[astrologyTool] timezone error", error);
      // Keep default 5.5 on failure
    }

    // 3) BASE BIRTH DETAILS – used by many other endpoints
    const birthPayload = {
      day,
      month,
      year,
      hour,
      min: minute,
      lat: latitude,
      lon: longitude,
      tzone,
    };

    let birthDetails: unknown;
    try {
      birthDetails = await astrologyPost("birth_details", birthPayload);
    } catch (error) {
      console.error("[astrologyTool] birth_details error", error);
      return {
        type: "astrology-error",
        message:
          "There was a technical problem while calculating your chart. Please double-check your birth details and try again.",
      };
    }

    // 4) Extra info depending on query type
    let extra: unknown = null;

    if (queryType === "birth_chart") {
      try {
        // North Indian chart layout – chartId = 1
        extra = await astrologyPost("horo_chart/1", birthPayload);
      } catch (error) {
        console.error("[astrologyTool] horo_chart error", error);
      }
    } else if (queryType === "general_report") {
      try {
        extra = await astrologyPost("general_ascendant_report", birthPayload);
      } catch (error) {
        console.error("[astrologyTool] general_ascendant_report error", error);
      }
    }

    // 5) Final structured result – the model will turn this into text for the user
    return {
      type: "astrology-success",
      name,
      resolvedLocation: {
        requested: place,
        matchedPlace: candidate.place_name,
        countryCode,
        latitude,
        longitude,
        timezoneId,
        tzone,
      },
      birthDetails,
      extra,
    };
  },
});
