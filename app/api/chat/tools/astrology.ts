// app/api/chat/tools/astrology-tool.ts

import { tool } from "ai";
import { z } from "zod";

const ASTROLOGY_BASE_URL = "https://json.astrologyapi.com/v1";

function getAstrologyAuthHeader(): string {
  const userId = process.env.ASTROLOGY_API_USER_ID;
  const apiKey = process.env.ASTROLOGY_API_KEY;

  if (!userId || !apiKey) {
    throw new Error(
      "ASTROLOGY_API_USER_ID or ASTROLOGY_API_KEY is not set in environment."
    );
  }

  const authString = `${userId}:${apiKey}`;

  let encoded: string;

  // Edge runtime (Vercel) has Web APIs like btoa
  if (typeof btoa === "function") {
    encoded = btoa(authString);
  } else if (typeof Buffer !== "undefined") {
    // Node.js fallback if needed
    // @ts-ignore - Buffer may not be typed in edge but is safe-guarded
    encoded = Buffer.from(authString, "utf-8").toString("base64");
  } else {
    throw new Error("No base64 encoder available for Astrology API auth.");
  }

  return `Basic ${encoded}`;
}

async function callAstrologyApi<TResponse>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  const response = await fetch(`${ASTROLOGY_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: getAstrologyAuthHeader(),
      "Content-Type": "application/json",
      "Accept-Language": "en",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `AstrologyAPI error (${endpoint}): ${response.status} ${response.statusText} ${text}`
    );
  }

  return (await response.json()) as TResponse;
}

type LocationInfo = {
  timezoneId: string;
  tzone: number;
  lat: number;
  lon: number;
};

// 1) Try AstrologyAPI geo_details
// 2) If that fails, fall back to OpenStreetMap (so your bot STILL works)
async function geocodePlace(place: string): Promise<LocationInfo> {
  // --- Try AstrologyAPI geo_details first ---
  try {
    type GeoResult = {
      timezone_id?: string;
      timezone?: string | number;
      tzone?: string | number;
      latitude?: string | number;
      longitude?: string | number;
      lat?: string | number;
      lon?: string | number;
    };

    const geo = await callAstrologyApi<GeoResult[]>("geo_details", {
      place,
      maxRows: 3,
    });

    if (Array.isArray(geo) && geo.length > 0) {
      const first = geo[0];

      const timezoneId =
        first.timezone_id ||
        "Asia/Kolkata"; // sensible default for most Indian users

      const tzoneRaw = first.tzone ?? first.timezone ?? 5.5;

      const latRaw = first.latitude ?? first.lat;
      const lonRaw = first.longitude ?? first.lon;

      const lat =
        typeof latRaw === "string" ? parseFloat(latRaw) : Number(latRaw);
      const lon =
        typeof lonRaw === "string" ? parseFloat(lonRaw) : Number(lonRaw);

      const tzone =
        typeof tzoneRaw === "string" ? parseFloat(tzoneRaw) : Number(tzoneRaw);

      if (!Number.isNaN(lat) && !Number.isNaN(lon) && !Number.isNaN(tzone)) {
        return { timezoneId, tzone, lat, lon };
      }
    }
  } catch (err) {
    console.error("AstrologyAPI geo_details failed, falling back:", err);
  }

  // --- Fallback: OpenStreetMap Nominatim ---
  const osmResp = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      place
    )}&limit=1`,
    {
      headers: {
        "User-Agent": "ZodiAI/1.0 (https://zodi-ai.example)", // put your domain if you have one
        "Accept-Language": "en",
      },
    }
  );

  if (!osmResp.ok) {
    throw new Error(`OSM geocode failed for "${place}": ${osmResp.status}`);
  }

  const osmData = (await osmResp.json()) as Array<{
    lat: string;
    lon: string;
  }>;

  if (!Array.isArray(osmData) || osmData.length === 0) {
    throw new Error(`No location found for "${place}"`);
  }

  const { lat: latStr, lon: lonStr } = osmData[0];
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  // Very rough timezone guess: India vs rest of world
  let timezoneId = "UTC";
  let tzone = 0;

  if (lat >= 6 && lat <= 37 && lon >= 68 && lon <= 98) {
    timezoneId = "Asia/Kolkata";
    tzone = 5.5;
  }

  return { timezoneId, tzone, lat, lon };
}

type AstrologyToolErrorResult = {
  type: "error";
  message: string;
};

type AstrologyBirthChartResult = {
  type: "birth_chart";
  name: string;
  place: string;
  timezoneId: string;
  tzone: number;
  lat: number;
  lon: number;
  rawAstroDetails: unknown;
};

type AstrologyPredictionResult = {
  type: "prediction";
  name: string;
  place: string;
  timezoneId: string;
  tzone: number;
  lat: number;
  lon: number;
  rawPrediction: unknown;
};

type AstrologyToolResult =
  | AstrologyToolErrorResult
  | AstrologyBirthChartResult
  | AstrologyPredictionResult;

export const astrologyTool = tool({
  description:
    "Look up a user's birth chart or general horoscope using their birth details and place of birth.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("User's first name to personalize the reading."),
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(1900).max(2100),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    place: z
      .string()
      .describe(
        "Place of birth. Prefer 'City, State, Country', e.g. 'Junagadh, Gujarat, India'."
      ),
    queryType: z
      .enum(["birth_chart", "general_prediction"])
      .describe(
        "Use 'birth_chart' for a full Kundli-style chart, or 'general_prediction' for a lighter reading."
      ),
  }),
  // Cast the whole tool definition to `any` to avoid the TypeScript overload error.
} as any);

// We export execute separately so TypeScript is happy and runtime works.
(astrologyTool as any).execute = async (
  input: any
): Promise<AstrologyToolResult> => {
  const { name, day, month, year, hour, minute, place, queryType } = input;

  let location: LocationInfo;

  try {
    location = await geocodePlace(place);
  } catch (err) {
    console.error("Location resolution failed:", err);
    return {
      type: "error",
      message: `I couldn't resolve the place "${place}" into a valid location. Ask the user for a nearby major city (for example, instead of a small village use the closest district HQ).`,
    };
  }

  const { lat, lon, tzone, timezoneId } = location;

  const baseBirthData = {
    day,
    month,
    year,
    hour,
    min: minute,
    lat,
    lon,
    tzone,
  };

  if (queryType === "birth_chart") {
    try {
      const astroDetails = await callAstrologyApi<unknown>(
        "astro_details",
        baseBirthData
      );

      return {
        type: "birth_chart",
        name,
        place,
        timezoneId,
        tzone,
        lat,
        lon,
        rawAstroDetails: astroDetails,
      };
    } catch (err) {
      console.error("AstrologyAPI astro_details failed:", err);
      return {
        type: "error",
        message:
          "I ran into an issue while fetching your detailed birth chart. Give a softer, high-level reading instead of going silent.",
      };
    }
  }

  // queryType === "general_prediction"
  try {
    const prediction = await callAstrologyApi<unknown>(
      "birth_details",
      baseBirthData
    );

    return {
      type: "prediction",
      name,
      place,
      timezoneId,
      tzone,
      lat,
      lon,
      rawPrediction: prediction,
    };
  } catch (err) {
    console.error("AstrologyAPI birth_details failed:", err);
    return {
      type: "error",
      message:
        "I faced a problem while fetching your horoscope data. Fall back to a gentle, sign-based prediction instead of failing.",
    };
  }
};
