// app/api/chat/tools/astrology.ts

import { tool } from "ai";
import { z } from "zod";

/**
 * Base URL for AstrologyAPI (Vedic/Indian JSON API).
 */
const ASTROLOGY_API_BASE_URL = "https://json.astrologyapi.com/v1";

/**
 * Helper to build the Basic Auth header for AstrologyAPI.
 * Reads credentials from environment variables:
 *   - ASTROLOGY_API_USER_ID
 *   - ASTROLOGY_API_KEY
 */
function makeAuthHeader() {
  const userId = process.env.ASTROLOGY_API_USER_ID;
  const apiKey = process.env.ASTROLOGY_API_KEY;

  if (!userId || !apiKey) {
    throw new Error(
      "Missing ASTROLOGY_API_USER_ID or ASTROLOGY_API_KEY environment variables."
    );
  }

  // Try browser-style btoa first (Edge runtime), fall back to Node Buffer.
  let base64: string;
  if (typeof btoa === "function") {
    base64 = btoa(`${userId}:${apiKey}`);
  } else {
    // @ts-ignore - Buffer exists in Node; in Edge it is polyfilled by Next.
    base64 = Buffer.from(`${userId}:${apiKey}`).toString("base64");
  }

  return `Basic ${base64}`;
}

/**
 * Generic helper to call any AstrologyAPI endpoint with POST + JSON body.
 */
async function callAstrologyApi(endpoint: string, data: any) {
  const response = await fetch(`${ASTROLOGY_API_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      authorization: makeAuthHeader(),
      "Content-Type": "application/json",
      "Accept-Language": "en",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `AstrologyAPI error on ${endpoint}: ${response.status} ${text}`
    );
  }

  return response.json();
}

/**
 * Helper to convert timezone_id => numeric offset (tzone).
 * For now we handle India explicitly and default everything else to 0 (UTC).
 * You can extend this mapping later if needed.
 */
function timezoneIdToOffsetHours(timezoneId: string | undefined): number {
  if (!timezoneId) return 0;
  if (timezoneId === "Asia/Kolkata") return 5.5;
  // TODO: extend for other zones if you want more accuracy.
  return 0;
}

/**
 * ZodiAI Astrology Tool
 *
 * This tool:
 * 1) Takes name + birth details + place name.
 * 2) Uses AstrologyAPI geo_details to find lat/lon/timezone.
 * 3) Uses birth_details + a couple of life-report APIs.
 * 4) Returns a structured bundle for the model to turn into a scary-but-nice reading.
 */
export const astrologyTool = tool(
  {
    description:
      "Use this when the user gives their name and birth details (date, time, place) and wants an Indian astrology reading about their life, career, love, or health.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("Name of the user, used only to personalize the message."),
      day: z.number().int().min(1).max(31).describe("Birth day, e.g. 6."),
      month: z.number().int().min(1).max(12).describe("Birth month, 1-12."),
      year: z
        .number()
        .int()
        .min(1900)
        .max(2100)
        .describe("Birth year, e.g. 2000."),
      hour: z
        .number()
        .int()
        .min(0)
        .max(23)
        .describe("Birth hour in 24-hour format, 0–23."),
      minute: z
        .number()
        .int()
        .min(0)
        .max(59)
        .describe("Birth minute, 0–59."),
      place: z
        .string()
        .describe(
          "Birth place (city + country), e.g. 'Mumbai, India' or 'New York, USA'."
        ),
      focus_area: z
        .enum(["general", "love", "career", "health"])
        .default("general")
        .describe(
          "What the user mainly cares about right now: general, love, career, or health."
        ),
    }),

    // NOTE: execute is inside the SAME object – tool(...) only takes ONE argument
    async execute(input: any) {
      const { name, day, month, year, hour, minute, place, focus_area } = input;

      // 1) Look up geo details (lat, lon, timezone_id) for the place
      const geoJson: any = await callAstrologyApi("geo_details", {
        place,
        maxRows: 1,
      });

      const geo = geoJson?.geonames?.[0];
      if (!geo) {
        throw new Error(
          `Could not resolve place "${place}" via AstrologyAPI geo_details.`
        );
      }

      const latitude = Number(geo.latitude);
      const longitude = Number(geo.longitude);
      const timezoneId = geo.timezone_id as string | undefined;
      const tzone = timezoneIdToOffsetHours(timezoneId);
