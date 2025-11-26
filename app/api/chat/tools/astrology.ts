// app/api/chat/tools/astrology.ts

import { z } from "zod";

/**
 * Build Basic Auth header for AstrologyAPI.
 */
function getAstrologyAuthHeader(): string {
  const userId = process.env.ASTROLOGY_USER_ID;
  const apiKey = process.env.ASTROLOGY_API_KEY;

  if (!userId || !apiKey) {
    throw new Error(
      "Astrology API credentials missing. Set ASTROLOGY_USER_ID and ASTROLOGY_API_KEY in env."
    );
  }

  const base64 = Buffer.from(`${userId}:${apiKey}`, "utf8").toString("base64");
  return `Basic ${base64}`;
}

/**
 * Low-level helper to call AstrologyAPI JSON endpoints.
 */
async function callAstrologyApi(endpoint: string, body: any) {
  const res = await fetch(`https://json.astrologyapi.com/v1/${endpoint}`, {
    method: "POST",
    headers: {
      authorization: getAstrologyAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `AstrologyAPI ${endpoint} failed (${res.status}): ${text || "no body"}`
    );
  }

  return res.json();
}

/**
 * Resolve place name -> lat, lon, timezone, tzone using OpenStreetMap.
 * Falls back to hard-coded Indian cities (Mumbai, Junagadh, etc.) if needed.
 */
async function geocodePlace(place: string) {
  const query = place.trim();
  if (!query) throw new Error("Empty place string");

  // ---------- 1) hard-coded fallbacks first (cheap & reliable) ----------
  const key = query.toLowerCase();
  const fallbackTable: Record<
    string,
    { lat: number; lon: number; timezoneId: string; tzone: number }
  > = {
    mumbai: { lat: 19.076, lon: 72.8777, timezoneId: "Asia/Kolkata", tzone: 5.5 },
    "mumbai, india": {
      lat: 19.076,
      lon: 72.8777,
      timezoneId: "Asia/Kolkata",
      tzone: 5.5,
    },
    junagadh: {
      lat: 21.5167,
      lon: 70.4667,
      timezoneId: "Asia/Kolkata",
      tzone: 5.5,
    },
    "junagadh, india": {
      lat: 21.5167,
      lon: 70.4667,
      timezoneId: "Asia/Kolkata",
      tzone: 5.5,
    },
    delhi: { lat: 28.6139, lon: 77.209, timezoneId: "Asia/Kolkata", tzone: 5.5 },
    "new delhi": {
      lat: 28.6139,
      lon: 77.209,
      timezoneId: "Asia/Kolkata",
      tzone: 5.5,
    },
    bangalore: {
      lat: 12.9716,
      lon: 77.5946,
      timezoneId: "Asia/Kolkata",
      tzone: 5.5,
    },
    bengaluru: {
      lat: 12.9716,
      lon: 77.5946,
      timezoneId: "Asia/Kolkata",
      tzone: 5.5,
    },
    ahmedabad: {
      lat: 23.0225,
      lon: 72.5714,
      timezoneId: "Asia/Kolkata",
      tzone: 5.5,
    },
  };

  if (fallbackTable[key]) {
    const fb = fallbackTable[key];
    return {
      lat: fb.lat,
      lon: fb.lon,
      timezoneId: fb.timezoneId,
      tzone: fb.tzone,
      resolvedPlace: query,
    };
  }

  // ---------- 2) OpenStreetMap Nominatim ----------
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&limit=1&addressdetails=1`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "ZodiAI-StudentProject/1.0 (contact: you@example.com)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Geocoding request failed with status ${res.status}`);
  }

  const data: any[] = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No geocoding results for "${query}"`);
  }

  const best = data[0];
  const lat = parseFloat(best.lat);
  const lon = parseFloat(best.lon);
  const countryCode: string | undefined = best.address?.country_code;
  const inIndia = countryCode?.toLowerCase() === "in";

  return {
    lat,
    lon,
    timezoneId: inIndia ? "Asia/Kolkata" : "UTC",
    tzone: inIndia ? 5.5 : 0,
    resolvedPlace: best.display_name as string,
  };
}

/**
 * Astrology tool object (NO call to tool()).
 * This is what you import in route.ts and add to the tools map.
 */
export const astrologyTool: any = {
  description:
    "Uses Vedic Astrology to generate a birth chart style reading from birth date, time and place.",

  parameters: z.object({
    name: z.string().describe("User's first name."),
    day: z.number().int().min(1).max(31).describe("Day of birth (1–31)."),
    month: z.number().int().min(1).max(12).describe("Month of birth (1–12)."),
    year: z
      .number()
      .int()
      .min(1900)
      .max(2100)
      .describe("Year of birth, e.g. 2000."),
    hour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe("Hour of birth in 24h format (0–23)."),
    minute: z
      .number()
      .int()
      .min(0)
      .max(59)
      .describe("Minute of birth (0–59)."),
    place: z
      .string()
      .describe(
        "Place of birth (e.g. 'Junagadh, India' or 'Mumbai, India'). Short forms like 'Junagadh' also work."
      ),
    queryType: z
      .enum(["birth_chart", "basic_traits"])
      .default("birth_chart")
      .describe(
        "Use 'birth_chart' for full chart-style reading, 'basic_traits' for lighter personality focus."
      ),
  }),

  /**
   * Called by the AI model when it chooses this tool.
   */
  execute: async (input: any) => {
    const { name, day, month, year, hour, minute, place, queryType } = input;

    // 1) Resolve location
    let geo;
    try {
      geo = await geocodePlace(place);
    } catch (err: any) {
      console.error("[astrologyTool] geocode error", err);
      return {
        type: "astrology_error",
        message: `I couldn't resolve the place of birth "${place}". Ask the user to try again with a nearby big city and country name (e.g. "Junagadh, India" or "Mumbai, India").`,
      };
    }

    const { lat, lon, tzone, timezoneId, resolvedPlace } = geo;

    // 2) Call Vedic astro_details
    let astro;
    try {
      astro = await callAstrologyApi("astro_details", {
        day,
        month,
        year,
        hour,
        min: minute,
        lat,
        lon,
        tzone,
      });
    } catch (err: any) {
      console.error("[astrologyTool] astro_details error", err);
      return {
        type: "astrology_error",
        message: `Astrology engine failed while generating your chart. Reason: ${
          err?.message || "unknown"
        }.`,
      };
    }

    // 3) Shape output – the model will turn this into nice text
    if (queryType === "basic_traits") {
      return {
        type: "basic_traits",
        name,
        place: resolvedPlace,
        timezoneId,
        tzone,
        lat,
        lon,
        rawAstroDetails: astro,
      };
    }

    return {
      type: "birth_chart",
      name,
      place: resolvedPlace,
      timezoneId,
      tzone,
      lat,
      lon,
      rawAstroDetails: astro,
    };
  },
};
