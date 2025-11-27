import {
  streamText,
  UIMessage,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { MODEL } from "@/config";
import { SYSTEM_PROMPT } from "@/prompts";
import { isContentFlagged } from "@/lib/moderation";
import { webSearch } from "./tools/web-search";
import { vectorDatabaseSearch } from "./tools/search-vector-database";
import { astrologyTool as rawAstrologyTool } from "./tools/astrology";

// Ensure Node.js runtime so Buffer works in astrology tool
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Safe wrapper around the astrology tool so that:
 * - any error is caught and logged
 * - we ALWAYS return a value for the tool call
 *   (so the UI never gets stuck on "Using tool")
 */
const astrologyTool = {
  ...(rawAstrologyTool as any),
  async execute(input: any) {
    try {
      const result = await (rawAstrologyTool as any).execute(input);

      // Defensive: if the tool forgot to return, give the model a hint
      if (typeof result === "undefined") {
        return {
          ok: false,
          message:
            "Astrology service returned no data. Please answer using general Vedic astrology knowledge only.",
        };
      }

      return result;
    } catch (error) {
      console.error("Astrology tool failed:", error);

      // Tell the model explicitly that the tool failed so it can still answer
      return {
        ok: false,
        message:
          "The external astrology service is temporarily unavailable. Please answer using general Vedic astrology principles only, without external API data.",
      };
    }
  },
};

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // --- moderation on latest user message ---
  const latestUserMessage = messages.filter((msg) => msg.role === "user").pop();

  if (latestUserMessage) {
    const textParts = latestUserMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part ? part.text : ""))
      .join("");

    if (textParts) {
      const moderationResult = await isContentFlagged(textParts);

      if (moderationResult.flagged) {
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = "moderation-denial-text";

            writer.write({ type: "start" });
            writer.write({ type: "text-start", id: textId });
            writer.write({
              type: "text-delta",
              id: textId,
              delta:
                moderationResult.denialMessage ||
                "Your message violates our guidelines. I can't answer that.",
            });
            writer.write({ type: "text-end", id: textId });
            writer.write({ type: "finish" });
          },
        });

        return createUIMessageStreamResponse({ stream });
      }
    }
  }

  // --- main chat logic with safe tools + global fallback ---
  try {
    const result = streamText({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages: convertToModelMessages(messages),
      tools: {
        webSearch,
        vectorDatabaseSearch,
        astrologyTool, // <- safe wrapper
      },
      stopWhen: stepCountIs(10),
      providerOptions: {
        openai: {
          reasoningSummary: "auto",
          reasoningEffort: "low",
          parallelToolCalls: false,
        },
      },
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
    });
  } catch (error) {
    console.error("Chat route failed:", error);

    // If *anything* goes wrong above, stream a graceful fallback message
    const stream = createUIMessageStream({
      execute({ writer }) {
        const textId = "fallback-error-text";

        writer.write({ type: "start" });
        writer.write({ type: "text-start", id: textId });
        writer.write({
          type: "text-delta",
          id: textId,
          delta:
            "Panditji ko abhi astrology service se signal nahi mil raha, lekin main general Vedic astrology ke basis par baat kar sakta hoon. Thoda simple shabdon mein apna sawaal phir se batao, beta.",
        });
        writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish" });
      },
    });

    return createUIMessageStreamResponse({ stream });
  }
}
