"use client";

import Image from "next/image";
import { UIMessage } from "ai";
import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type VoiceLanguage = "en" | "hi" | "gu" | "hinglish";

type TalkingPanditProps = {
  messages: UIMessage[];
  sendMessage: (args: { text: string }) => void;
  enabled?: boolean;
  language?: VoiceLanguage;
};

// ---------- helpers ----------

function extractTextFromMessage(message: UIMessage): string {
  const anyMsg: any = message;
  if (typeof anyMsg.text === "string") return anyMsg.text;
  if (typeof anyMsg.content === "string") return anyMsg.content;
  if (Array.isArray(anyMsg.parts)) {
    return anyMsg.parts
      .map((p: any) => {
        if (typeof p === "string") return p;
        if (typeof p.text === "string") return p.text;
        return "";
      })
      .join(" ");
  }
  return "";
}

// short conversational summary for TTS
function getSpokenSummary(fullText: string): string {
  if (!fullText) return "";

  const sentences = fullText.split(/(?<=[.!?])\s+/);
  const short = sentences.slice(0, 3).join(" ");

  const trimmed = short.length > 350 ? short.slice(0, 347) + "..." : short;

  // make it feel like a spoken response
  return `Sun beta, main short mein bataun: ${trimmed}`;
}

function localeFor(language: VoiceLanguage): string {
  switch (language) {
    case "hi":
      return "hi-IN";
    case "gu":
      return "gu-IN";
    case "hinglish":
    case "en":
    default:
      return "en-IN"; // Indian English works well for Hinglish
  }
}

// ---------- avatar ----------

function PanditAvatar({
  listening,
  speaking,
}: {
  listening: boolean;
  speaking: boolean;
}) {
  const active = listening || speaking;

  return (
    <div className="relative h-14 w-14">
      <div
        className={`absolute inset-0 rounded-full bg-gradient-to-br from-orange-200 to-orange-50 shadow-lg transition ${
          active ? "scale-105" : "scale-100"
        }`}
      />
      <div
        className={`absolute inset-1 rounded-full bg-white transition ${
          active ? "ring-2 ring-orange-400" : "ring-0"
        }`}
      />
      <Image
        src="/pandit-talk.gif"
        alt="ZodiAI Panditji"
        width={56}
        height={56}
        className={`relative h-14 w-14 rounded-full object-cover transition ${
          speaking ? "animate-pulse" : ""
        }`}
      />
    </div>
  );
}

// ---------- main widget ----------

export function TalkingPandit({
  messages,
  sendMessage,
  enabled = true,
  language = "en",
}: TalkingPanditProps) {
  const [isClient, setIsClient] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastSpokenId, setLastSpokenId] = useState<string | null>(null);
  const [hasIntroduced, setHasIntroduced] = useState(false);

  const recognitionRef = useRef<any | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // ---------- init STT ----------

  useEffect(() => {
    setIsClient(true);
    if (typeof window === "undefined") return;

    const win = window as any;
    const SpeechRecognition =
      win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = localeFor(language);
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript && transcript.trim()) {
        sendMessage({ text: transcript.trim() });
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setSpeechSupported(true);
  }, [sendMessage, language]);

  // ---------- helpers to stop TTS completely ----------

  const hardStopSpeaking = () => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setIsSpeaking(false);
  };

  // stop speech whenever widget is disabled
  useEffect(() => {
    if (!isClient) return;
    if (!enabled) {
      hardStopSpeaking();
      try {
        recognitionRef.current?.stop();
      } catch {}
      setIsListening(false);
    }
  }, [enabled, isClient]);

  // stop speech when TTS is toggled off
  useEffect(() => {
    if (!isClient) return;
    if (!ttsEnabled) {
      hardStopSpeaking();
    }
  }, [ttsEnabled, isClient]);

  // ---------- mic handlers ----------

  const startListening = () => {
    if (!speechSupported || !recognitionRef.current) {
      alert(
        "Voice input is not supported in this browser. Try Chrome on desktop or Android."
      );
      return;
    }
    // if pandit is speaking, stop and start listening
    hardStopSpeaking();

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      console.error("Error starting recognition", err);
    }
  };

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {}
    setIsListening(false);
  };

  // ---------- intro line (once) ----------

  useEffect(() => {
    if (!isClient || !enabled || hasIntroduced) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const intro =
      language === "gu"
        ? "Kem cho beta? Hu ZodiAI chu, tamaro AI pandit. Shu puchvu chho?"
        : language === "hi" || language === "hinglish"
        ? "Namaste beta, main ZodiAI hoon, tumhara AI Pandit. Bolo beta, kya puchna hai?"
        : "Hello beta, I'm ZodiAI, your AI Pandit. Tell me beta, what's your question?";

    const utterance = new SpeechSynthesisUtterance(intro);
    utterance.lang = localeFor(language);

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
    };

    hardStopSpeaking();
    window.speechSynthesis.speak(utterance);
    utteranceRef.current = utterance;
    setHasIntroduced(true);
  }, [enabled, isClient, language, hasIntroduced]);

  // ---------- speak summary of new assistant messages ----------

  useEffect(() => {
    if (!isClient || !ttsEnabled || !enabled) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    if (last.id === lastSpokenId) return;

    const fullText = extractTextFromMessage(last);
    if (!fullText.trim()) return;

    const spokenText = getSpokenSummary(fullText);
    if (!spokenText.trim()) return;

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = localeFor(language);

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
    };

    hardStopSpeaking();
    window.speechSynthesis.speak(utterance);
    utteranceRef.current = utterance;
    setLastSpokenId(last.id);
  }, [messages, isClient, ttsEnabled, enabled, lastSpokenId, language]);

  if (!isClient || !enabled) return null;

  const subtitle = isListening
    ? "Listening… bolo beta."
    : "Tap mic and ask your question.";

  return (
    <div className="fixed bottom-24 right-4 z-40">
      <div className="flex items-center gap-3 rounded-3xl border border-orange-100 bg-white/95 px-4 py-3 shadow-xl">
        <PanditAvatar listening={isListening} speaking={isSpeaking} />

        <div className="mr-2 flex flex-col">
          <span className="text-sm font-semibold text-slate-900">
            Talk to Panditji
          </span>
          <span className="text-[11px] text-slate-500">{subtitle}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* mic */}
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={!speechSupported}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md ${
              isListening
                ? "bg-orange-500"
                : "bg-orange-400 hover:bg-orange-500"
            }`}
            title={isListening ? "Stop listening" : "Start listening"}
          >
            {isListening ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          {/* speaker toggle */}
          <button
            type="button"
            onClick={() => setTtsEnabled((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            title={ttsEnabled ? "Mute Pandit voice" : "Unmute Pandit voice"}
          >
            {ttsEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TalkingPandit;
