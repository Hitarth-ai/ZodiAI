import { tool } from "ai";
import { z } from "zod";

const ASTROLOGY_API_USER_ID = process.env.ASTROLOGY_API_USER_ID;
const ASTROLOGY_API_KEY = process.env.ASTROLOGY_API_KEY;
const ASTROLOGY_API_BASE =
  process.env.ASTROLOGY_API_BASE || "https://json.astrologyapi.com/v1";

if (!ASTROLOGY_API_USER_ID || !ASTROLOGY_API_KEY) {
  console.warn(
    "[AstrologyTool] ASTROLOGY_API_USER_ID or ASTROLOGY_API_KEY is not set. " +
      "The astrology tool will return an error until you configure them."
  );
}

function buildAuthHeader() {
  if (!ASTROLOGY_API_USER_ID || !ASTROLOGY_API_KEY) {
    throw new Error(
      "Astrology API credentials are not configured. " +
        "Please set ASTROLOGY_API_USER_ID and ASTROLOGY_API_KEY in your environment."
    );
  }

  const token = Buffer.from(
    `${ASTROLOGY_API_USER_ID}:${ASTROLOGY_API_KEY}`
  ).toString("base64");

  return `Basic ${token}`;
}

// Generic helper to call any AstrologyAPI JSON endpoint (POST)
async function callAstrologyApi(
  endpoint: string,
  payload: Record<string, unknown>
) {
  const res = await fetch(`${ASTROLOGY_API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildAuthHeader(),
      "Accept-Language": "en",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AstrologyAPI error ${res.status}: ${text}`);
  }

  return res.json();
}

// 1) Look up lat / lon / timezone_id from free-text place using geo_details
async function lookupGeo(place: string) {
  const data = await callAstrologyApi("geo_details", {
    place,
    maxRows: 5,
  });

  // Response shape:
  // { geonames: [{ place_name, latitude, longitude, timezone_id, country_code }, ...] }
  const geonames = (data as any).geonames;

  if (!Array.isArray(geonames) || geonames.length === 0) {
    throw new Error(
      `I couldn't find any location for "${place}". ` +
        `Try a nearby big city like "Mumbai" or "Ahmedabad, India".`
    );
  }

  const best = geonames[0];

  return {
    lat: Number(best.latitude),
    lon: Number(best.longitude),
    timezoneId: String(best.timezone_id),
    countryCode: String(best.country_code),
    placeName: String(best.place_name),
  };
}

// 2) Convert timezone_id (e.g. "Asia/Kolkata") into numeric offset (e.g. 5.5)
async function lookupTimezoneOffset(timezoneId: string) {
  const data = await callAstrologyApi("timezone", {
    country_code: timezoneId, // docs: "time zone id, get from geo_details api"
    isDst: true,
  });

  const offset = parseFloat(String((data as any).timezone));

  if (Number.isNaN(offset)) {
    throw new Error(
      `Couldn't resolve timezone offset for "${timezoneId}". ` +
        "Please try again with a different city."
    );
  }

  return offset;
}

// 3) The actual AI tool the model will call
export const astrologyTool = tool({
  description:
    "Look up Vedic astrology information (birth chart or daily nakshatra prediction) " +
    "using AstrologyAPI based on the user's birth details.",

  inputSchema: z.object({
    name: z.string().describe("User's name."),
    day: z.number().int().min(1).max(31).describe("Day of birth (1–31)."),
    month: z.number().int().min(1).max(12).describe("Month of birth (1–12)."),
    year: z
      .number()
      .int()
      .min(1900)
      .max(2100)
      .describe("Year of birth (4-digit)."),
    hour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe("Hour of birth in 24-hour format (0–23)."),
    minute: z
      .number()
      .int()
      .min(0)
      .max(59)
      .describe("Minute of birth (0–59)."),
    place: z
      .string()
      .describe(
        "Birth place as free text, ideally 'City, State, Country' " +
          "(e.g. 'Junagadh, Gujarat, India' or 'Mumbai, India')."
      ),
    queryType: z
      .enum(["birth_chart", "daily_prediction"])
      .describe(
        "What the user wants: 'birth_chart' for natal details, " +
          "'daily_prediction' for today's nakshatra-based prediction."
      ),
  }),

  async execute(input) {
    try {
      const { name, day, month, year, hour, minute, place, queryType } = input;

      // A. Resolve place ➜ lat / lon / timezone_id
      const geo = await lookupGeo(place);

      // B. Get numeric timezone offset (e.g. 5.5)
      const tzone = await lookupTimezoneOffset(geo.timezoneId);

      // C. Shared birth details payload shape per docs
      const birthDetails = {
        day,
        month,
        year,
        hour,
        min: minute,
        lat: geo.lat,
        lon: geo.lon,
        tzone,
      };

      if (queryType === "birth_chart") {
        const rawBirth = await callAstrologyApi("astro_details", birthDetails);

        return {
          type: "birth_chart",
          name,
          location: geo.placeName,
          timezone: geo.timezoneId,
          tzone,
          rawBirth,
        };
      }

      if (queryType === "daily_prediction") {
        const rawPrediction = await callAstrologyApi(
          "daily_nakshatra_prediction",
          birthDetails
        );

        return {
          type: "daily_prediction",
          name,
          location: geo.placeName,
          timezone: geo.timezoneId,
          tzone,
          rawPrediction,
        };
      }

      // Should never hit because queryType is an enum
      return {
        type: "error",
        message:
          "I couldn't understand whether you wanted a birth chart or a daily prediction.",
      };
    } catch (err) {
      console.error("[AstrologyTool] Error:", err);
      return {
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Something went wrong while talking to the astrology service. Please try again.",
      };
    }
  },
});
