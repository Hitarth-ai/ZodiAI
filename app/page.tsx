"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageWall } from "@/components/messages/message-wall";

import { ArrowUp, Loader2, Mic, Square, Trash2, Volume2, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { CLEAR_CHAT_TEXT, OWNER_NAME, WELCOME_MESSAGE } from "@/config";

// -------------------- Types & constants --------------------

const formSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty.")
    .max(4000, "Message must be at most 4000 characters."),
});

type BirthDetails = {
  name: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  place: string;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  messages: UIMessage[];
  durations: Record<string, number>;
  birthDetails?: BirthDetails;
};

type Theme = {
  main: string;
  sidebar: string;
  text: string;
};

const EMPTY_BIRTH: BirthDetails = {
  name: "",
  day: "",
  month: "",
  year: "",
  hour: "",
  minute: "",
  place: "",
};

// main = lighter chat bg, sidebar = darker shade (also text colour)
const MOON_COLORS: Record<string, { main: string; sidebar: string }> = {
  Aries: { main: "#9a5f5aff", sidebar: "#461b17ff" },
  Taurus: { main: "#A3A78B", sidebar: "#3c4026ff" },
  Gemini: { main: "#f9ebc9ff", sidebar: "#735522ff" },
  Cancer: { main: "#b3d3dbff", sidebar: "#1e4f5aff" },
  Leo: { main: "#ddc69dff", sidebar: "#7e570eff" },
  Virgo: { main: "#d5ab96ff", sidebar: "#744a35ff" },
  Libra: { main: "#d6bdbdff", sidebar: "#502525ff" },
  Scorpio: { main: "#ad9ca5ff", sidebar: "#301d26ff" },
  Sagittarius: { main: "#e7ddb2ff", sidebar: "#4d431bff" },
  Capricorn: { main: "#D5E4DD", sidebar: "#AAB6B1" },
  Aquarius: { main: "#a1cde6ff", sidebar: "#366885ff" },
  Pisces: { main: "#D8A7A1", sidebar: "#AD8681" },
};

const DEFAULT_THEME: Theme = {
  main: MOON_COLORS.Gemini.main,
  sidebar: MOON_COLORS.Gemini.sidebar,
  text: MOON_COLORS.Gemini.sidebar, // darkest tone
};

const CONVERSATIONS_KEY = "zodiai-conversations-v2";
const ACTIVE_CONV_KEY = "zodiai-active-conversation-id";
const MOON_KEY = "zodiai-moon-sign";

const STATIC_DEFAULT_CONVERSATION: Conversation = {
  id: "initial",
  title: "New chat",
  createdAt: "2024-01-01T00:00:00.000Z", // Fixed date for hydration match
  messages: [],
  durations: {},
  birthDetails: EMPTY_BIRTH,
};

// -------------------- Helpers --------------------

function getThemeFromLocalStorage(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const moon = window.localStorage.getItem(MOON_KEY) || "Gemini";
    const base =
      MOON_COLORS[moon as keyof typeof MOON_COLORS] ?? MOON_COLORS.Gemini;
    return {
      main: base.main,
      sidebar: base.sidebar,
      text: base.sidebar, // text always = darkest tone
    };
  } catch {
    return DEFAULT_THEME;
  }
}

function detectMoonSign(text: string): string | null {
  // Broad regex to find "Moon", "Rashi", or "Sign" followed by a zodiac sign within ~100 chars
  // Matches: "Moon sign is Aries", "Your Rashi is **Taurus**", "Moon in Gemini", "Aries Moon"
  const signs = Object.keys(MOON_COLORS).join("|");

  // 1. Look for "Moon/Rashi/Sign ... [Sign]"
  // \b ensures we match whole words (e.g. not "Cancerous")
  const forwardRegex = new RegExp(`(?:Moon|Rashi|Sign).{0,100}?\\b(${signs})\\b`, "i");
  const forwardMatch = text.match(forwardRegex);

  if (forwardMatch && forwardMatch[1]) {
    return forwardMatch[1].charAt(0).toUpperCase() + forwardMatch[1].slice(1).toLowerCase();
  }

  // 2. Look for "[Sign] ... Moon/Rashi" (e.g. "Aries Moon")
  const backwardRegex = new RegExp(`\\b(${signs})\\b.{0,50}?(?:Moon|Rashi)`, "i");
  const backwardMatch = text.match(backwardRegex);

  if (backwardMatch && backwardMatch[1]) {
    return backwardMatch[1].charAt(0).toUpperCase() + backwardMatch[1].slice(1).toLowerCase();
  }

  return null;
}

function loadConversations(): {
  conversations: Conversation[];
  activeId: string | null;
} {
  if (typeof window === "undefined")
    return { conversations: [], activeId: null };

  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY);
    const active = window.localStorage.getItem(ACTIVE_CONV_KEY);
    if (!raw) return { conversations: [], activeId: null };
    const conversations = JSON.parse(raw) as Conversation[];
    return { conversations, activeId: active };
  } catch {
    return { conversations: [], activeId: null };
  }
}

function saveConversations(conversations: Conversation[], activeId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    window.localStorage.setItem(ACTIVE_CONV_KEY, activeId);
  } catch (error) {
    console.error("Failed to save conversations to localStorage:", error);
    // Optionally toast.error("Could not save chat history. Storage full?");
  }
}

function extractPlainText(message: UIMessage): string {
  if (!message.parts) return "";
  return message.parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text ?? "")
    .join(" ");
}

// short conversational summary for TTS
function getSpokenSummary(fullText: string): string {
  if (!fullText) return "";

  // basic sentence split
  const sentences = fullText.split(/(?<=[.!?])\s+/);
  const short = sentences.slice(0, 2).join(" "); // first 2 sentences

  const trimmed = short.length > 260 ? short.slice(0, 257) + "..." : short;

  // make it feel like a spoken reply but without extra filler
  return trimmed;
}

// -------------------- Component --------------------

export default function Chat() {
  // 🌙 THEME DRIVEN BY MOON SIGN FROM LOCALSTORAGE
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  // initial theme on mount
  useEffect(() => {
    setTheme(getThemeFromLocalStorage());
  }, []);

  const [conversationsState, setConversations] = useState<Conversation[]>([
    STATIC_DEFAULT_CONVERSATION,
  ]);

  const [activeId, setActiveId] = useState<string>(
    STATIC_DEFAULT_CONVERSATION.id
  );
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);



  const activeConversation = useMemo(
    () => conversationsState.find((c) => c.id === activeId)!,
    [conversationsState, activeId]
  );

  const [durations, setDurations] = useState<Record<string, number>>(
    activeConversation.durations || {}
  );
  const [birthDetails, setBirthDetails] = useState<BirthDetails>(
    activeConversation.birthDetails || EMPTY_BIRTH
  );

  const [language, setLanguage] = useState<
    "English" | "Hindi" | "Gujarati" | "Hinglish"
  >("English");

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const welcomeMessageShownRef = useRef(false);
  const lastSpokenAssistantRef = useRef<string | null>(null);

  const initialMessagesRef = useRef<UIMessage[]>(
    activeConversation.messages || []
  );
  const { messages, sendMessage, status, stop, setMessages } = useChat({
    messages: initialMessagesRef.current,
  });

  // Load conversations from localStorage on mount
  useEffect(() => {
    const { conversations, activeId } = loadConversations();
    if (conversations.length > 0) {
      setConversations(conversations);
      const targetId = activeId || conversations[0].id;
      setActiveId(targetId);

      // Update chat state for the loaded conversation
      const conv = conversations.find((c) => c.id === targetId);
      if (conv) {
        setMessages(conv.messages || []);
        setDurations(conv.durations || {});
        setBirthDetails(conv.birthDetails || EMPTY_BIRTH);
      }
    } else {
      // If no conversations found, update the default one with current date
      setConversations([
        {
          ...STATIC_DEFAULT_CONVERSATION,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  }, []);

  // 🔁 Whenever messages change, check for Moon Sign in the last assistant message
  useEffect(() => {
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === "assistant") {
      const text = extractPlainText(lastMessage);
      const detectedSign = detectMoonSign(text);

      if (detectedSign && MOON_COLORS[detectedSign]) {
        // Update localStorage
        if (typeof window !== "undefined") {
          const currentStored = window.localStorage.getItem(MOON_KEY);
          if (currentStored !== detectedSign) {
            window.localStorage.setItem(MOON_KEY, detectedSign);
            // Update theme state immediately
            const base = MOON_COLORS[detectedSign];
            setTheme({
              main: base.main,
              sidebar: base.sidebar,
              text: base.sidebar,
            });
          }
        }
      }
    }
  }, [messages]);

  // when active conversation changes, load its state ONCE
  useEffect(() => {
    const conv = conversationsState.find((c) => c.id === activeId);
    if (!conv) return;
    setMessages(conv.messages || []);
    setDurations(conv.durations || {});
    setBirthDetails(conv.birthDetails || EMPTY_BIRTH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // persist conversations when current conv data changes
  useEffect(() => {
    const currentId = activeIdRef.current;
    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === currentId
          ? { ...c, messages: messages, durations, birthDetails }
          : c
      );
      saveConversations(updated, currentId);
      return updated;
    });
  }, [messages, durations, birthDetails]);

  // one-time welcome message for very first chat
  useEffect(() => {
    if (welcomeMessageShownRef.current) return;
    if (messages.length > 0) return;

    const hasAnyHistory = conversationsState.some(
      (c) => c.messages && c.messages.length > 0
    );
    if (hasAnyHistory) return;

    const welcomeMessage: UIMessage = {
      id: `welcome-${Date.now()}`,
      role: "assistant",
      parts: [{ type: "text", text: WELCOME_MESSAGE }],
    };
    setMessages([welcomeMessage]);
    welcomeMessageShownRef.current = true;
  }, [messages.length, conversationsState, setMessages]);

  // form for message box
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { message: "" },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const decorated = `[Language: ${language}] ${data.message}`;
    sendMessage({ text: decorated });
    form.reset();
  };

  // new chat
  const handleNewChat = () => {
    const newId = `conv-${Date.now()}`;
    const newConv: Conversation = {
      id: newId,
      title: "New chat",
      createdAt: new Date().toISOString(),
      messages: [],
      durations: {},
      birthDetails: EMPTY_BIRTH,
    };

    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newId);
    setMessages([]);
    setDurations({});
    setBirthDetails(EMPTY_BIRTH);
    lastSpokenAssistantRef.current = null;
  };

  // delete chat
  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      const nextActive =
        id === activeId ? filtered[0]?.id ?? "none" : activeId;

      if (filtered.length === 0) {
        const newConv: Conversation = {
          id: "initial",
          title: "New chat",
          createdAt: new Date().toISOString(),
          messages: [],
          durations: {},
          birthDetails: EMPTY_BIRTH,
        };
        saveConversations([newConv], newConv.id);
        setActiveId(newConv.id);
        setMessages([]);
        setDurations({});
        setBirthDetails(EMPTY_BIRTH);
        return [newConv];
      }

      if (nextActive !== activeId) setActiveId(nextActive);
      saveConversations(filtered, nextActive);
      return filtered;
    });
  };

  const handleDurationChange = (key: string, duration: number) => {
    setDurations((prev) => ({ ...prev, [key]: duration }));
  };

  // Name -> chat title
  useEffect(() => {
    if (!birthDetails.name?.trim()) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId ? { ...c, title: birthDetails.name.trim() } : c
      )
    );
  }, [birthDetails.name, activeId]);

  // ---------- Voice Pandit ----------

  const speakText = (text: string) => {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;

    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang =
      language === "Hindi"
        ? "hi-IN"
        : language === "Gujarati"
          ? "gu-IN"
          : "en-IN";
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => {
      setIsSpeaking(false);
      utteranceRef.current = null; // Clear ref on end
    };
    utter.onerror = () => {
      setIsSpeaking(false);
      utteranceRef.current = null; // Clear ref on error
    };

    // Store in ref to prevent garbage collection
    utteranceRef.current = utter;
    synth.speak(utter);
  };

  // Helper to get a spoken summary (full response, stripped markdown)
  const getSpokenSummary = (text: string): string => {
    // 1. Strip markdown
    const cleanText = text
      .replace(/\*\*(.*?)\*\*/g, "$1") // bold
      .replace(/\*(.*?)\*/g, "$1") // italic
      .replace(/#{1,6}\s?/g, "") // headers
      .replace(/`{1,3}(.*?)`{1,3}/g, "$1") // code
      .replace(/\[(.*?)\]\(.*?\)/g, "$1") // links
      .replace(/[-*]\s/g, "") // list bullets
      .replace(/\n/g, " "); // newlines to spaces

    // Return full cleaned text, limited to reasonable length (e.g. 2000 chars)
    // This allows for much longer responses than before
    if (cleanText.length > 2000) {
      return cleanText.substring(0, 2000) + "...";
    }
    return cleanText;
  };

  useEffect(() => {
    if (!voiceEnabled) return;
    // Don't speak while the AI is still thinking or streaming
    if (status === "submitted" || status === "streaming") return;

    const lastAssistant = [...messages]
      .slice()
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const text = extractPlainText(lastAssistant);
    if (!text || text === lastSpokenAssistantRef.current) return;

    const summary = getSpokenSummary(text);
    if (!summary) return;

    lastSpokenAssistantRef.current = text;
    speakText(summary);
  }, [messages, voiceEnabled, status]);

  const handleVoiceQuestion = (spokenText: string) => {
    const prefix =
      language === "Hindi"
        ? "Please answer in simple Hindi, 3-4 short sentences, as if speaking."
        : language === "Gujarati"
          ? "Please answer in simple Gujarati, 3-4 short sentences, as if speaking."
          : language === "Hinglish"
            ? "Please answer in casual Hinglish (mix of Hindi and English), 3-4 short sentences."
            : "Please answer in friendly English, 3-4 short sentences, suitable to be spoken out loud.";

    const text = `[Voice mode] ${prefix}\nUser: "${spokenText}"`;
    sendMessage({ text });
  };

  const recognitionRef = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const startListening = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Browser does not support speech recognition.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang =
      language === "Hindi"
        ? "hi-IN"
        : language === "Gujarati"
          ? "gu-IN"
          : "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setIsListening(false);
      if (transcript?.trim()) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        handleVoiceQuestion(transcript.trim());
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const stopListening = () => {
    const rec = recognitionRef.current;
    if (rec) {
      rec.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  const handleMicClick = () => {
    if (isListening) stopListening();
    else startListening();
  };

  const toggleVoiceEnabled = () => {
    const newVal = !voiceEnabled;
    setVoiceEnabled(newVal);
    if (!newVal) {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
      lastSpokenAssistantRef.current = null;
    }
  };

  // -------------------- Render --------------------

  return (
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{ backgroundColor: theme.sidebar, color: theme.text }}
    >
      {/* MOBILE OVERLAY */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* LEFT SIDEBAR (split: history + pandit) */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-80 flex flex-col border-r border-white/40 text-white transition-transform duration-300 md:relative md:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        style={{ backgroundColor: theme.sidebar }}
      >
        {/* Mobile Close Button */}
        <div className="md:hidden flex justify-end p-2">
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-2 text-white/80 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        {/* Upper: Previous chats (scrollable) */}
        {/* Upper: Previous chats (scrollable) - Takes exactly 50% height */}
        <div className="h-1/2 flex flex-col overflow-hidden border-b border-white/20">
          <div className="px-4 pt-4 pb-2">
            <p className="text-sm font-semibold">Previous chats</p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-2">
            {conversationsState.length === 0 ? (
              <p className="text-xs" style={{ opacity: 0.7 }}>
                You don&apos;t have previous chats yet. Start a new chat and it
                will appear here.
              </p>
            ) : (
              <div className="space-y-3">
                {conversationsState.map((conv) => (
                  <div
                    key={conv.id}
                    className={`rounded-2xl px-3 py-3 text-xs bg-white/10 border ${conv.id === activeId
                      ? "border-white/70"
                      : "border-white/20"
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {conv.title || "Untitled chat"}
                        </p>
                        <p
                          className="text-[11px] truncate"
                          style={{ opacity: 0.7 }}
                          suppressHydrationWarning
                        >
                          {new Date(conv.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteConversation(conv.id)}
                        className="p-1 rounded-full hover:bg-white/20"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="mt-2 flex justify-between items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveId(conv.id)}
                        className="px-3 py-1 rounded-full bg-white text-[11px] font-medium"
                        style={{ color: theme.sidebar }}
                      >
                        Open chat
                      </button>
                      <span className="text-[10px]" style={{ opacity: 0.7 }}>
                        {conv.messages.length} msg
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 text-[11px]" style={{ opacity: 0.7 }}>
              Chats are stored only in this browser (localStorage).
            </p>
          </div>
        </div>

        {/* Lower: Talking Pandit */}
        {/* Lower: Talking Pandit - Takes exactly 50% height */}
        <div className="h-1/2 flex flex-col items-center justify-center p-4 relative">
          {/* Centered Pandit GIF */}
          <div className="relative w-28 h-28 md:w-40 md:h-40 flex items-center justify-center mb-4 md:mb-6">
            <Image
              src={
                isSpeaking
                  ? "/pandit-talk.gif"
                  : "/Pandit.png"
              }
              alt="Pandit avatar"
              fill
              className="object-contain select-none pointer-events-none"
              unoptimized
              priority
              quality={100}
            />
          </div>

          {/* Status Text */}
          <div className="text-center mb-6 space-y-1">
            <p className="text-lg font-semibold">Talk to Panditji</p>
            <p className="text-xs opacity-80">
              {isListening ? "Listening..." : "Tap mic to speak"}
            </p>
          </div>

          {/* Controls Row */}
          <div className="flex items-center gap-6">
            {/* Mic Toggle */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={handleMicClick}
                className={`flex items-center justify-center rounded-full w-12 h-12 border transition-all ${isListening ? "bg-white text-black scale-110" : "bg-white/10 hover:bg-white/20 text-white"
                  }`}
                style={{
                  borderColor: isListening ? "transparent" : "rgba(255,255,255,0.3)",
                }}
              >
                <Mic className="w-5 h-5" />
              </button>
              <span className="text-[10px] uppercase tracking-wider opacity-70">
                {isListening ? "Mic On" : "Mic Off"}
              </span>
            </div>

            {/* Voice Toggle */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={toggleVoiceEnabled}
                className={`flex items-center justify-center rounded-full w-12 h-12 border transition-all ${voiceEnabled ? "bg-white text-black" : "bg-white/10 hover:bg-white/20 text-white"
                  }`}
                style={{
                  borderColor: voiceEnabled ? "transparent" : "rgba(255,255,255,0.3)",
                }}
              >
                <Volume2 className="w-5 h-5" />
              </button>
              <span className="text-[10px] uppercase tracking-wider opacity-70">
                {voiceEnabled ? "Voice On" : "Voice Off"}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CHAT AREA */}
      <main
        className="flex-1 flex flex-col h-screen overflow-hidden text-black"
        style={{ backgroundColor: theme.main }}
      >
        {/* TOP BAR */}
        <header
          className="flex items-center justify-between px-4 py-2 md:px-6 md:py-3 border-b text-white"
          style={{
            borderColor: "rgba(255,255,255,0.4)",
            backgroundColor: theme.sidebar
          }}
        >
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <button
              type="button"
              className="md:hidden p-1 -ml-2 text-white/80 hover:text-white"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>

            <Avatar className="size-9 ring-1 ring-white/60 bg-white">
              <AvatarImage src="/logo.png" />
              <AvatarFallback>Z</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-semibold text-sm">
                ZodiAI – Your AI Panditji
              </span>
              <span className="text-[11px] hidden md:inline" style={{ opacity: 0.8 }}>
                Gentle Vedic insights — not deterministic predictions.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Language dropdown */}
            <div className="flex items-center gap-1">
              <span className="hidden md:inline" style={{ opacity: 0.8 }}>Language</span>
              <select
                value={language}
                onChange={(e) =>
                  setLanguage(e.target.value as typeof language)
                }
                className="text-xs rounded-full border px-2 py-1 md:px-3 bg-white/20 border-white/40 text-white"
                style={{ color: "white" }}
              >
                <option value="English">English</option>
                <option value="Hindi">हिंदी</option>
                <option value="Hinglish">Hinglish</option>
                <option value="Gujarati">ગુજરાતી</option>
              </select>
            </div>

            {/* Share chat button */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-xs rounded-full bg-white/20 border border-white/40 text-white hover:bg-white/30 hover:text-white hidden md:flex"
              style={{ color: "white", borderColor: "rgba(255,255,255,0.4)" }}
              onClick={() => {
                if (typeof window !== "undefined") {
                  navigator.clipboard
                    .writeText(window.location.href)
                    .then(() => toast.success("Chat link copied!"))
                    .catch(() => toast.error("Could not copy link."));
                }
              }}
            >
              Share chat
            </Button>
          </div>
        </header>

        {/* SCROLLABLE CHAT CONTENT */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Birth details card */}
          <section className="max-w-3xl w-full mx-auto mb-6 bg-white/95 rounded-3xl shadow-sm border border-white/60 px-4 py-3 md:px-6 md:py-5">
            <h2 className="text-base md:text-lg font-semibold mb-1">
              Step 1 · Enter your birth details
            </h2>
            <p
              className="text-xs md:text-sm mb-3 md:mb-4"
              style={{ color: theme.sidebar, opacity: 0.9 }}
            >
              ZodiAI uses your date, time and place of birth to call Vedic
              astrology APIs and interpret your chart. If you don&apos;t know
              the exact time, an approximate hour is ok.
            </p>

            <div className="space-y-3">
              <Input
                placeholder="Name"
                value={birthDetails.name}
                onChange={(e) =>
                  setBirthDetails((b) => ({ ...b, name: e.target.value }))
                }
                className="rounded-2xl h-9 md:h-11 text-xs md:text-sm"
                style={{ color: "black" }}
              />

              <div className="grid grid-cols-5 gap-2 md:gap-3">
                <Input
                  placeholder="DD"
                  value={birthDetails.day}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, day: e.target.value }))
                  }
                  className="rounded-2xl h-9 md:h-11 text-xs md:text-sm px-2 md:px-3"
                  style={{ color: "black" }}
                />
                <Input
                  placeholder="MM"
                  value={birthDetails.month}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, month: e.target.value }))
                  }
                  className="rounded-2xl h-9 md:h-11 text-xs md:text-sm px-2 md:px-3"
                  style={{ color: "black" }}
                />
                <Input
                  placeholder="YYYY"
                  value={birthDetails.year}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, year: e.target.value }))
                  }
                  className="rounded-2xl h-9 md:h-11 text-xs md:text-sm px-2 md:px-3"
                  style={{ color: "black" }}
                />
                <Input
                  placeholder="Hour"
                  value={birthDetails.hour}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, hour: e.target.value }))
                  }
                  className="rounded-2xl h-9 md:h-11 text-xs md:text-sm px-2 md:px-3"
                  style={{ color: "black" }}
                />
                <Input
                  placeholder="Min"
                  value={birthDetails.minute}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, minute: e.target.value }))
                  }
                  className="rounded-2xl h-9 md:h-11 text-xs md:text-sm px-2 md:px-3"
                  style={{ color: "black" }}
                />
              </div>

              <Input
                placeholder="Place of birth (City, Country)"
                value={birthDetails.place}
                onChange={(e) =>
                  setBirthDetails((b) => ({ ...b, place: e.target.value }))
                }
                className="rounded-2xl h-9 md:h-11 text-xs md:text-sm"
                style={{ color: "black" }}
              />

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  className="rounded-full bg-slate-900 text-white px-5"
                  onClick={() => {
                    const summary = `My name is ${birthDetails.name}. My date of birth is ${birthDetails.day}-${birthDetails.month}-${birthDetails.year} at ${birthDetails.hour}:${birthDetails.minute}. I was born in ${birthDetails.place}. Please use Vedic astrology to interpret my chart, then show me a menu of what ZodiAI can help me with.`;
                    const decorated = `[Language: ${language}] ${summary}`;
                    sendMessage({ text: decorated });
                  }}
                  disabled={!birthDetails.name || !birthDetails.day}
                >
                  Send details to ZodiAI
                </Button>
              </div>
            </div>

            <p
              className="mt-3 text-[11px]"
              style={{ color: theme.sidebar, opacity: 0.8 }}
            >
              This information is used only inside this browser session so
              ZodiAI can personalise responses. Do not enter passwords, ID
              numbers or other sensitive data.
            </p>
          </section>

          {/* Message wall */}
          <section className="flex flex-col items-center justify-end min-h-[40vh]">
            <MessageWall
              messages={messages}
              status={status}
              durations={durations}
              onDurationChange={handleDurationChange}
            />
            {status === "submitted" && (
              <div className="flex justify-start max-w-3xl w-full mt-2">
                <Loader2
                  className="size-4 animate-spin"
                  style={{ color: theme.text, opacity: 0.7 }}
                />
              </div>
            )}
          </section>
        </div>

        {/* BOTTOM INPUT BAR – background same as main chat, text darkest tone */}
        <footer
          className="border-t px-4 py-2 md:px-6 md:py-3"
          style={{
            borderColor: "rgba(255,255,255,0.8)",
            backgroundColor: theme.main,
          }}
        >
          <div className="max-w-3xl mx-auto space-y-2">
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <FieldGroup>
                <Controller
                  name="message"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="chat-message" className="sr-only">
                        Message
                      </FieldLabel>
                      <div className="relative">
                        <textarea
                          id="chat-message"
                          {...field}
                          rows={3}
                          className="w-full rounded-3xl border bg-white/95 px-4 py-2 md:py-3 pr-14 text-sm resize-none outline-none h-12 md:h-auto"
                          style={{ color: "black" }} // black text for better visibility
                          placeholder="Ask anything"
                          disabled={status === "streaming"}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              form.handleSubmit(onSubmit)();
                            }
                          }}
                        />
                        {(status === "ready" || status === "error") && (
                          <Button
                            className="absolute right-2 bottom-2 rounded-full h-8 w-8"
                            type="submit"
                            disabled={!field.value.trim()}
                            size="icon"
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                        )}
                        {(status === "streaming" ||
                          status === "submitted") && (
                            <Button
                              className="absolute right-2 bottom-2 rounded-full h-8 w-8"
                              size="icon"
                              type="button"
                              onClick={() => stop()}
                            >
                              <Square className="size-4" />
                            </Button>
                          )}
                      </div>
                    </Field>
                  )}
                />
              </FieldGroup>
            </form>

            <div
              className="flex items-center justify-between text-[11px]"
              style={{ color: theme.text }}
            >

              <div className="flex items-center gap-2">
                <span style={{ opacity: 0.7 }}>
                  © {new Date().getFullYear()} {OWNER_NAME}
                </span>
                <Link href="/terms" className="underline">
                  Terms of Use
                </Link>
                <span style={{ opacity: 0.7 }}>· Powered by</span>
                <Link href="https://ringel.ai/" className="underline">
                  Ringel.AI
                </Link>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border bg-white/90"
                style={{ color: theme.sidebar, borderColor: "transparent" }}
                onClick={handleNewChat}
              >
                <span className="font-medium text-xs">{CLEAR_CHAT_TEXT}</span>
              </button>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
