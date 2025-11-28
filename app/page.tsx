"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import { useChat } from "@ai-sdk/react";
import { UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { MessageWall } from "@/components/messages/message-wall";

import { ArrowUp, Loader2, Mic, Square, Trash2, Volume2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import {
  CLEAR_CHAT_TEXT,
  OWNER_NAME,
  WELCOME_MESSAGE,
} from "@/config";

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

const MOON_COLORS: Record<string, { main: string; sidebar: string }> = {
  Aries: { main: "#9A463E", sidebar: "#7B3832" },
  Taurus: { main: "#A3A78B", sidebar: "#82866F" },
  Gemini: { main: "#F2EEE5", sidebar: "#C2BEB7" },
  Cancer: { main: "#B8CDD2", sidebar: "#93A4A8" },
  Leo: { main: "#C1A166", sidebar: "#9A8152" },
  Virgo: { main: "#C28F76", sidebar: "#9B725E" },
  Libra: { main: "#D1D1D1", sidebar: "#A7A7A7" },
  Scorpio: { main: "#3E2C35", sidebar: "#32232A" },
  Sagittarius: { main: "#F9E27D", sidebar: "#C7B564" },
  Capricorn: { main: "#D5E4DD", sidebar: "#AAB6B1" },
  Aquarius: { main: "#2E5A73", sidebar: "#25485C" },
  Pisces: { main: "#D8A7A1", sidebar: "#AD8681" },
};

const DEFAULT_THEME: Theme = {
  main: MOON_COLORS.Gemini.main,
  sidebar: MOON_COLORS.Gemini.sidebar,
  text: "#111827",
};

const CONVERSATIONS_KEY = "zodiai-conversations-v2";
const ACTIVE_CONV_KEY = "zodiai-active-conversation-id";

// -------------------- Helpers --------------------

function getThemeFromLocalStorage(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const moon = window.localStorage.getItem("zodiai-moon-sign") || "Gemini";
  const base = MOON_COLORS[moon] ?? MOON_COLORS.Gemini;
  return {
    main: base.main,
    sidebar: base.sidebar,
    text: base.sidebar, // darkest tone of that palette
  };
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
  window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  window.localStorage.setItem(ACTIVE_CONV_KEY, activeId);
}

function extractPlainText(message: UIMessage): string {
  if (!message.parts) return "";
  return message.parts
    .filter((p) => p.type === "text")
    .map((p: any) => p.text ?? "")
    .join(" ");
}

// -------------------- Component --------------------

export default function Chat() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  const [{ conversations, activeId: initialActive }] = useState(() =>
    loadConversations()
  );

  const [conversationsState, setConversations] = useState<Conversation[]>(
    conversations.length
      ? conversations
      : [
          {
            id: "initial",
            title: "New chat",
            createdAt: new Date().toISOString(),
            messages: [],
            durations: {},
          },
        ]
  );

  const [activeId, setActiveId] = useState<string>(
    initialActive || conversationsState[0].id
  );

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

  const welcomeMessageShownRef = useRef(false);
  const lastSpokenAssistantRef = useRef<string | null>(null);

  const initialMessagesRef = useRef<UIMessage[]>(
    activeConversation.messages || []
  );
  const { messages, sendMessage, status, stop, setMessages } = useChat({
    messages: initialMessagesRef.current,
  });

  // theme refresh when moon sign saved
  useEffect(() => {
    setTheme(getThemeFromLocalStorage());
  }, [messages.length]);

  // sync when active conversation changes
  useEffect(() => {
    const conv = conversationsState.find((c) => c.id === activeId);
    if (!conv) return;
    setMessages(conv.messages || []);
    setDurations(conv.durations || {});
    setBirthDetails(conv.birthDetails || EMPTY_BIRTH);
  }, [activeId, conversationsState, setMessages]);

  // persist conversations
  useEffect(() => {
    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === activeId
          ? { ...c, messages: messages, durations, birthDetails }
          : c
      );
      saveConversations(updated, activeId);
      return updated;
    });
  }, [messages, durations, birthDetails, activeId]);

  // show welcome only for first overall chat
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

  // form
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

  // delete
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

      if (nextActive !== activeId) {
        setActiveId(nextActive);
      }
      saveConversations(filtered, nextActive);
      return filtered;
    });
  };

  const handleDurationChange = (key: string, duration: number) => {
    setDurations((prev) => ({ ...prev, [key]: duration }));
  };

  // name -> title
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
    utter.onend = () => setIsSpeaking(false);
    synth.speak(utter);
  };

  useEffect(() => {
    if (!voiceEnabled) return;
    const lastAssistant = [...messages]
      .slice()
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const text = extractPlainText(lastAssistant);
    if (!text || text === lastSpokenAssistantRef.current) return;
    lastSpokenAssistantRef.current = text;
    speakText(text);
  }, [messages, voiceEnabled]);

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
      {/* FIXED LEFT SIDEBAR (split: top = history, bottom = pandit) */}
      <aside
        className="w-80 h-screen flex flex-col border-r border-white/40"
        style={{ backgroundColor: theme.sidebar }}
      >
        {/* Upper: Previous chats (scrollable list) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-sm font-semibold">Previous chats</p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-2">
            {conversationsState.length === 0 ? (
              <p className="text-xs opacity-70">
                You don&apos;t have previous chats yet. Start a new chat and it
                will appear here.
              </p>
            ) : (
              <div className="space-y-3">
                {conversationsState.map((conv) => (
                  <div
                    key={conv.id}
                    className={`rounded-2xl px-3 py-3 text-xs bg-white/10 border ${
                      conv.id === activeId
                        ? "border-white/70"
                        : "border-white/20"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {conv.title || "Untitled chat"}
                        </p>
                        <p className="opacity-70 text-[11px] truncate">
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
                      >
                        Open chat
                      </button>
                      <span className="text-[10px] opacity-70">
                        {conv.messages.length} msg
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 text-[11px] opacity-70">
              Chats are stored only in this browser (localStorage).
            </p>
          </div>
        </div>

        {/* Lower: Talking Pandit (fixed area) */}
        <div className="px-4 pb-4 pt-3 border-t border-white/30">
          <div className="flex items-center gap-3 rounded-3xl bg-white/15 px-3 py-3 shadow-sm">
            <div className="relative w-14 h-14 rounded-full overflow-hidden bg-white/80 flex items-center justify-center">
              <Image
                src="/pandit-talk.gif"
                alt="Pandit avatar"
                fill
                className={`object-cover ${
                  isSpeaking ? "" : "opacity-80"
                } select-none pointer-events-none`}
              />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Talk to Panditji</p>
              <p className="text-xs opacity-80">
                {isListening
                  ? "Listening… ask your question."
                  : "Tap mic and ask your question."}
              </p>
              <p className="text-[11px] mt-1 opacity-90">
                {voiceEnabled ? "Voice: ON" : "Voice: OFF"}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleMicClick}
                className={`flex items-center justify-center rounded-full w-8 h-8 border text-xs ${
                  isListening ? "bg-white text-orange-600" : "bg-orange-500 text-white"
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={toggleVoiceEnabled}
                className={`flex items-center justify-center rounded-full w-8 h-8 border text-xs ${
                  voiceEnabled ? "bg-white text-orange-600" : "bg-white/60 text-slate-700"
                }`}
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CHAT AREA (scrollable content only) */}
      <main
        className="flex-1 flex flex-col h-screen overflow-hidden"
        style={{ backgroundColor: theme.main }}
      >
        {/* TOP BAR */}
        <header
          className="flex items-center justify-between px-6 py-3 border-b"
          style={{ borderColor: "rgba(255,255,255,0.8)" }}
        >
          <div className="flex items-center gap-3">
            <Avatar className="size-9 ring-1 ring-white/60 bg-white">
              <AvatarImage src="/logo.png" />
              <AvatarFallback>Z</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-semibold text-sm">
                ZodiAI – Your AI Panditji
              </span>
              <span className="text-[11px] opacity-80">
                Gentle Vedic insights — not deterministic predictions.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Language dropdown */}
            <div className="flex items-center gap-1">
              <span className="opacity-80">Language</span>
              <select
                value={language}
                onChange={(e) =>
                  setLanguage(e.target.value as typeof language)
                }
                className="text-xs rounded-full border px-3 py-1 bg-white/90"
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
              className="text-xs rounded-full bg-white/90"
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
          <section className="max-w-3xl w-full mx-auto mb-6 bg-white/95 rounded-3xl shadow-sm border border-white/60 px-6 py-5">
            <h2 className="text-lg font-semibold mb-1">
              Step 1 · Enter your birth details
            </h2>
            <p className="text-sm text-slate-600 mb-4">
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
                className="rounded-2xl h-11"
              />

              <div className="grid grid-cols-5 gap-3">
                <Input
                  placeholder="DD"
                  value={birthDetails.day}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, day: e.target.value }))
                  }
                  className="rounded-2xl h-11"
                />
                <Input
                  placeholder="MM"
                  value={birthDetails.month}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, month: e.target.value }))
                  }
                  className="rounded-2xl h-11"
                />
                <Input
                  placeholder="YYYY"
                  value={birthDetails.year}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, year: e.target.value }))
                  }
                  className="rounded-2xl h-11"
                />
                <Input
                  placeholder="Hour (0–23)"
                  value={birthDetails.hour}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, hour: e.target.value }))
                  }
                  className="rounded-2xl h-11"
                />
                <Input
                  placeholder="Minute"
                  value={birthDetails.minute}
                  onChange={(e) =>
                    setBirthDetails((b) => ({ ...b, minute: e.target.value }))
                  }
                  className="rounded-2xl h-11"
                />
              </div>

              <Input
                placeholder="Place of birth (City, Country)"
                value={birthDetails.place}
                onChange={(e) =>
                  setBirthDetails((b) => ({ ...b, place: e.target.value }))
                }
                className="rounded-2xl h-11"
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

            <p className="mt-3 text-[11px] text-slate-500">
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
                <Loader2 className="size-4 animate-spin text-slate-500" />
              </div>
            )}
          </section>
        </div>

        {/* BOTTOM INPUT BAR – background same as main chat */}
        <footer
          className="border-t px-6 py-3"
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
                          className="w-full rounded-3xl border bg-white/95 px-4 py-3 pr-14 text-sm resize-none outline-none"
                          placeholder="Ask ZodiAI a question about your chart. Press Enter to send · Shift+Enter for new line"
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

            <div className="flex items-center justify-between text-[11px] text-slate-700">
              <button
                type="button"
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border bg-white/90"
                onClick={handleNewChat}
              >
                <span className="font-medium text-xs">New</span>
              </button>
              <div className="flex items-center gap-2">
                <span className="opacity-70">
                  © {new Date().getFullYear()} {OWNER_NAME}
                </span>
                <Link href="/terms" className="underline">
                  Terms of Use
                </Link>
                <span className="opacity-70">· Powered by</span>
                <Link href="https://ringel.ai/" className="underline">
                  Ringel.AI
                </Link>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border bg-white/90"
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
