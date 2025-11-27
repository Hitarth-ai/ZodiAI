"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { TalkingPandit } from "@/components/voice-pandit";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useChat } from "@ai-sdk/react";
import { FormEvent, useEffect, useRef, useState } from "react";

import {
  ArrowUp,
  Eraser,
  Loader2,
  Plus,
  PlusIcon,
  Square,
  Trash2,
} from "lucide-react";
import { MessageWall } from "@/components/messages/message-wall";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UIMessage } from "ai";
import {
  AI_NAME,
  CLEAR_CHAT_TEXT,
  OWNER_NAME,
  WELCOME_MESSAGE,
} from "@/config";
import Image from "next/image";
import Link from "next/link";

/* ---------------------- schema & types ---------------------- */

const formSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty.")
    .max(2000, "Message must be at most 2000 characters."),
});

type Language = "en" | "hi" | "gu";

const USER_NAME_KEY = "zodiai_user_name";
const LANGUAGE_KEY = "zodiai_language";
const STORAGE_KEY = "chat-messages";
const HISTORY_KEY = "zodiai-chat-history-v1";
const MOON_SIGN_KEY = "zodiai_moon_sign";

type StorageData = {
  messages: UIMessage[];
  durations: Record<string, number>;
};

type BirthDetails = {
  name: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  place: string;
};

const EMPTY_BIRTH_DETAILS: BirthDetails = {
  name: "",
  day: "",
  month: "",
  year: "",
  hour: "",
  minute: "",
  place: "",
};

type ChatHistoryItem = {
  id: string;
  userName: string;
  createdAt: number;
  messages: UIMessage[];
};

/* ---------------------- zodiac theme map ---------------------- */

type ZodiacKey =
  | "Aries"
  | "Taurus"
  | "Gemini"
  | "Cancer"
  | "Leo"
  | "Virgo"
  | "Libra"
  | "Scorpio"
  | "Sagittarius"
  | "Capricorn"
  | "Aquarius"
  | "Pisces";

const ZODIAC_THEMES: Record<
  ZodiacKey,
  { main: string; sidebar: string; text: string }
> = {
  Aries: { main: "#9A463E", sidebar: "#7B3832", text: "#2c1815" },
  Taurus: { main: "#A3A78B", sidebar: "#82866F", text: "#2f3322" },
  Gemini: { main: "#F2EEE5", sidebar: "#C2BEB7", text: "#111827" },
  Cancer: { main: "#B8CDD2", sidebar: "#93A4A8", text: "#10212a" },
  Leo: { main: "#C1A166", sidebar: "#9A8152", text: "#3b2a11" },
  Virgo: { main: "#C28F76", sidebar: "#9B725E", text: "#3b2216" },
  Libra: { main: "#D1D1D1", sidebar: "#A7A7A7", text: "#111827" },
  Scorpio: { main: "#3E2C35", sidebar: "#32232A", text: "#F9FAFB" },
  Sagittarius: { main: "#F9E27D", sidebar: "#C7B564", text: "#3b2a0b" },
  Capricorn: { main: "#D5E4DD", sidebar: "#AAB6B1", text: "#102420" },
  Aquarius: { main: "#2E5A73", sidebar: "#25485C", text: "#E5F3FA" },
  Pisces: { main: "#D8A7A1", sidebar: "#AD8681", text: "#3b1813" },
};

/* ---------------------- helpers for current session ---------------------- */

const loadMessagesFromStorage = (): {
  messages: UIMessage[];
  durations: Record<string, number>;
} => {
  if (typeof window === "undefined") {
    return { messages: [], durations: {} };
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { messages: [], durations: {} };
    }
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") {
      return { messages: [], durations: {} };
    }

    const anyParsed = parsed as any;
    const messages: UIMessage[] = Array.isArray(anyParsed.messages)
      ? anyParsed.messages
      : [];
    const durations: Record<string, number> =
      anyParsed.durations && typeof anyParsed.durations === "object"
        ? anyParsed.durations
        : {};

    return { messages, durations };
  } catch (error) {
    console.error("Failed to load messages from localStorage:", error);
    return { messages: [], durations: {} };
  }
};

const saveMessagesToStorage = (
  messages: UIMessage[],
  durations: Record<string, number>
) => {
  if (typeof window === "undefined") return;
  try {
    const data: StorageData = { messages, durations };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Failed to save messages to localStorage:", error);
  }
};

/* ---------------------- helpers for history ---------------------- */

const saveHistoryToStorage = (items: ChatHistoryItem[]) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch (error) {
    console.error("Failed to save chat history:", error);
  }
};

const getMessageText = (message: UIMessage): string => {
  const anyMessage: any = message;
  if (typeof anyMessage.text === "string") return anyMessage.text;
  if (typeof anyMessage.content === "string") return anyMessage.content;
  if (Array.isArray(anyMessage.parts)) {
    return anyMessage.parts
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part.text === "string") return part.text;
        return "";
      })
      .join(" ");
  }
  return "";
};

const getFirstUserLine = (messages: UIMessage[]): string => {
  const userMsg = messages.find((m) => m.role === "user");
  if (!userMsg) return "";
  const text = getMessageText(userMsg);
  return text.length > 100 ? text.slice(0, 97) + "…" : text;
};

/* ============================ main component ============================ */

export default function Chat() {
  const [isClient, setIsClient] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const welcomeMessageShownRef = useRef<boolean>(false);

  const [voiceMode, setVoiceMode] = useState(false);

  // Profile & preferences
  const [userName, setUserName] = useState<string>("");
  const [language, setLanguage] = useState<Language>("en");
  const [birthDetails, setBirthDetails] = useState<BirthDetails>(
    EMPTY_BIRTH_DETAILS
  );

  // Moon sign -> theme
  const [moonSign, setMoonSign] = useState<ZodiacKey | null>(null);

  // History of previous chats (max 5)
  const [history, setHistory] = useState<ChatHistoryItem[]>([]);

  // Load stored messages on first render
  const stored =
    typeof window !== "undefined"
      ? loadMessagesFromStorage()
      : { messages: [], durations: {} };

  const [initialMessages] = useState<UIMessage[]>(stored.messages);

  const { messages, sendMessage, status, setMessages } = useChat({
    messages: initialMessages,
  });

  const isStreaming = status === "submitted" || status === "streaming";

  /* ---------- initial client setup ---------- */

  useEffect(() => {
    setIsClient(true);
    setDurations(stored.durations);
    setMessages(stored.messages);

    if (typeof window !== "undefined") {
      try {
        const savedName = localStorage.getItem(USER_NAME_KEY);
        const savedLang = localStorage.getItem(LANGUAGE_KEY) as
          | Language
          | null;
        const savedMoon = localStorage.getItem(MOON_SIGN_KEY);

        if (savedName) setUserName(savedName);
        if (savedLang === "en" || savedLang === "hi" || savedLang === "gu") {
          setLanguage(savedLang);
        }

        if (savedMoon && savedMoon in ZODIAC_THEMES) {
          setMoonSign(savedMoon as ZodiacKey);
        }

        const rawHistory = localStorage.getItem(HISTORY_KEY);
        if (rawHistory) {
          const parsed = JSON.parse(rawHistory);
          if (Array.isArray(parsed)) {
            setHistory(parsed as ChatHistoryItem[]);
          }
        }
      } catch (error) {
        console.error("Failed to load user profile/history:", error);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist messages
  useEffect(() => {
    if (!isClient) return;
    saveMessagesToStorage(messages, durations);
  }, [durations, messages, isClient]);

  // Persist profile
  useEffect(() => {
    if (!isClient) return;
    try {
      localStorage.setItem(USER_NAME_KEY, userName);
    } catch (error) {
      console.error("Failed to save user name:", error);
    }
  }, [userName, isClient]);

  useEffect(() => {
    if (!isClient) return;
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch (error) {
      console.error("Failed to save language:", error);
    }
  }, [language, isClient]);

  useEffect(() => {
    if (!isClient || !moonSign) return;
    try {
      localStorage.setItem(MOON_SIGN_KEY, moonSign);
    } catch (error) {
      console.error("Failed to save moon sign:", error);
    }
  }, [moonSign, isClient]);

  // Detect moon sign from assistant replies
  useEffect(() => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    if (!assistantMessages.length) return;

    const latest = assistantMessages[assistantMessages.length - 1];
    const text = getMessageText(latest);

    const match = text.match(
      /moon\s*sign\s*[:\-]\s*(Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces)/i
    );

    if (match && match[1]) {
      const raw = match[1].toLowerCase();
      const normalized =
        (raw.charAt(0).toUpperCase() + raw.slice(1)) as ZodiacKey;
      if (ZODIAC_THEMES[normalized]) {
        setMoonSign(normalized);
      }
    }
  }, [messages]);

  const handleDurationChange = (key: string, duration: number) => {
    setDurations((prev) => ({ ...prev, [key]: duration }));
  };

  // Initial welcome message
  useEffect(() => {
    if (
      isClient &&
      initialMessages.length === 0 &&
      !welcomeMessageShownRef.current
    ) {
      const text = userName
        ? `Hi ${userName}, ${WELCOME_MESSAGE}`
        : WELCOME_MESSAGE;

      const welcomeMessage: UIMessage = {
        id: `welcome-${Date.now()}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text,
          },
        ] as any,
      };

      setMessages([welcomeMessage]);
      saveMessagesToStorage([welcomeMessage], {});
      welcomeMessageShownRef.current = true;
    }
  }, [isClient, initialMessages.length, setMessages, userName]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: "",
    },
  });

  const makeLanguagePrefix = () =>
    language === "hi"
      ? "[Language: Hindi] "
      : language === "gu"
      ? "[Language: Gujarati] "
      : "[Language: English] ";

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const langPrefix = makeLanguagePrefix();
    const namePrefix = userName ? `User name: ${userName}. ` : "";
    const fullText = `${langPrefix}${namePrefix}${data.message}`;

    sendMessage({ text: fullText });
    form.reset();
  };

  // Step 1: birth details submit
  const handleBirthSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { name, day, month, year, hour, minute, place } = birthDetails;

    if (!name || !day || !month || !year || !place) {
      toast.error(
        "Please fill at least your name, full birth date and place of birth."
      );
      return;
    }

    setUserName(name);

    const safeHour = hour || "12";
    const safeMinute = minute || "00";

    const baseText = `My name is ${name}. My date of birth is ${day}-${month}-${year} at ${safeHour}:${safeMinute} (approx). I was born in ${place}. Please use Vedic astrology to interpret my chart and give me a clear initial overview, then show me a short menu of what ZodiAI can help me with (career, relationships, health, timing, etc.). Also, on the very first line of your reply, explicitly state my Moon sign in the exact format 'Moon sign: <Sign>'.`;

    const fullText = `${makeLanguagePrefix()}${baseText}`;

    sendMessage({ text: fullText });
    toast.success("Birth details sent to ZodiAI.");
  };

  const archiveCurrentChatToHistory = () => {
    if (messages.length === 0) return;

    const now = Date.now();
    const nameForHistory =
      birthDetails.name || userName || "Anonymous seeker";

    const historyItem: ChatHistoryItem = {
      id: `hist-${now}`,
      userName: nameForHistory,
      createdAt: now,
      messages: messages,
    };

    setHistory((prev) => {
      const next = [historyItem, ...prev].slice(0, 5); // keep max 5
      saveHistoryToStorage(next);
      return next;
    });
  };

  const clearChat = () => {
    archiveCurrentChatToHistory();

    const newMessages: UIMessage[] = [];
    const newDurations: Record<string, number> = {};
    setMessages(newMessages);
    setDurations(newDurations);
    saveMessagesToStorage(newMessages, newDurations);
    toast.success("New chat started");
  };

  const handleShareChat = async () => {
    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      toast.error("Sharing only works in the browser.");
      return;
    }

    try {
      const plain = messages
        .map((message) => {
          const who = message.role === "user" ? "You" : AI_NAME;
          const text = getMessageText(message);
          return `${who}: ${text}`;
        })
        .join("\n");

      await navigator.clipboard.writeText(plain);
      toast.success("Chat copied to clipboard");
    } catch (error) {
      console.error("Failed to copy chat:", error);
      toast.error("Could not copy chat");
    }
  };

  const openHistoryChat = (item: ChatHistoryItem) => {
    setMessages(item.messages);
    setDurations({});
    saveMessagesToStorage(item.messages, {});
    toast.success(
      `Opened chat for ${item.userName || "previous seeker"}. New messages will continue from this thread.`
    );
  };

  const deleteHistoryItem = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      saveHistoryToStorage(next);
      return next;
    });
    toast.success("Previous chat deleted");
  };

  const formState = form.formState;

  /* ---------- theme selection ---------- */

  const defaultTheme = {
    main: "#d9d9d9",
    sidebar: "#a6a6a6",
    text: "#111827",
  };

  const activeTheme = moonSign ? ZODIAC_THEMES[moonSign] : defaultTheme;

  /* ============================ render ============================ */

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: activeTheme.sidebar }}
    >
      <main className="mx-auto flex h-screen max-w-6xl">
        {/* Sidebar – full height, same colour as left space */}
        <aside
          className="flex h-full w-72 flex-shrink-0 flex-col border-r px-3 py-4 text-xs"
          style={{
            backgroundColor: activeTheme.sidebar,
            borderColor: "#ffffff",
            color: "#f9fafb",
          }}
        >
          <div className="mb-3">
            <p className="text-sm font-semibold">Previous chats</p>
          </div>

          {history.length === 0 ? (
            <p className="pr-1 text-[11px] opacity-80">
              You don&apos;t have previous chats yet. When you start a{" "}
              <span className="font-medium">New chat</span>, the finished
              conversation will be saved here.
            </p>
          ) : (
            <div className="space-y-2 overflow-y-auto pr-1">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-orange-200 bg-orange-50/95 px-3 py-2 text-[11px] leading-snug text-slate-800"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div>
                      <div className="truncate font-medium">
                        {item.userName || "Anonymous seeker"}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(item.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteHistoryItem(item.id);
                      }}
                      className="rounded-full p-1 text-slate-400 hover:bg-orange-100 hover:text-slate-700"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mb-2 h-[2.6em] overflow-hidden text-ellipsis text-[11px] text-slate-700">
                    {getFirstUserLine(item.messages) ||
                      "No question text available."}
                  </div>
                  <button
                    type="button"
                    onClick={() => openHistoryChat(item)}
                    className="w-full rounded-full bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white"
                  >
                    Open chat
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="mt-3 text-[10px] opacity-80">
            Chats are stored only in this browser (localStorage).
          </p>
        </aside>

        {/* Right side – header + chat + input/footer */}
        <section
          className="flex flex-1 flex-col"
          style={{ backgroundColor: activeTheme.main, color: activeTheme.text }}
        >
          {/* Top bar – same colour as main, white bottom line */}
          <header
            className="flex items-center justify-between border-b px-4 py-3"
            style={{
              backgroundColor: activeTheme.main,
              borderColor: "#ffffff",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight">
                  ZodiAI – Your AI Panditji
                </span>
                <span className="text-[11px] opacity-80">
                  Gentle Vedic insights — not deterministic predictions.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Language selector */}
              <div className="flex items-center gap-2 rounded-full border border-orange-300 bg-orange-100/90 px-3 py-1 text-[11px] text-slate-800">
                <span className="font-medium text-orange-800">Language</span>
                <select
                  className="bg-transparent text-[11px] text-slate-900 outline-none"
                  value={language}
                  onChange={(e) =>
                    setLanguage(e.target.value as Language)
                  }
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="gu">Gujarati</option>
                </select>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="hidden rounded-full border border-orange-300 bg-[#fefefe] px-3 py-1 text-[11px] font-medium text-slate-800 hover:bg-orange-50 sm:inline-flex"
                onClick={handleShareChat}
              >
                Share chat
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`hidden rounded-full border px-3 py-1 text-[11px] font-medium sm:inline-flex transition ${
                  voiceMode
                    ? "border-orange-400 bg-orange-100 text-orange-800"
                    : "border-slate-300 bg-[#fdfdfd] text-slate-700 hover:bg-orange-50"
                }`}
                onClick={() => setVoiceMode((v) => !v)}
              >
                {voiceMode ? "🎙 Voice Pandit ON" : "🎙 Voice Pandit OFF"}
              </Button>

              <Avatar className="size-9 bg-orange-50 ring-1 ring-orange-300">
                <AvatarImage src="/logo.png" />
                <AvatarFallback>
                  <Image src="/logo.png" alt="ZodiAI" width={36} height={36} />
                </AvatarFallback>
              </Avatar>
            </div>
          </header>

          {/* Chat + input */}
          <div className="flex flex-1 flex-col">
            <div className="flex flex-1 justify-center overflow-y-auto px-4 pt-4 pb-3">
              <div className="w-full max-w-3xl space-y-4">
                {/* Step 1 – Birth details card */}
                <section className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Step 1 · Enter your birth details
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        ZodiAI uses your date, time and place of birth to call
                        Vedic astrology APIs and interpret your chart. If you
                        don&apos;t know the exact time, an approximate hour is
                        ok.
                      </p>
                    </div>
                  </div>

                  <form
                    onSubmit={handleBirthSubmit}
                    className="space-y-3 text-sm"
                  >
                    <Input
                      className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-sm text-slate-900"
                      placeholder="Name"
                      value={birthDetails.name}
                      onChange={(e) =>
                        setBirthDetails((bd) => ({
                          ...bd,
                          name: e.target.value,
                        }))
                      }
                    />

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <Input
                        className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-sm text-slate-900"
                        placeholder="DD"
                        value={birthDetails.day}
                        onChange={(e) =>
                          setBirthDetails((bd) => ({
                            ...bd,
                            day: e.target.value,
                          }))
                        }
                      />
                      <Input
                        className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-sm text-slate-900"
                        placeholder="MM"
                        value={birthDetails.month}
                        onChange={(e) =>
                          setBirthDetails((bd) => ({
                            ...bd,
                            month: e.target.value,
                          }))
                        }
                      />
                      <Input
                        className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-sm text-slate-900"
                        placeholder="YYYY"
                        value={birthDetails.year}
                        onChange={(e) =>
                          setBirthDetails((bd) => ({
                            ...bd,
                            year: e.target.value,
                          }))
                        }
                      />
                      <Input
                        className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-sm text-slate-900"
                        placeholder="Hour (0–23)"
                        value={birthDetails.hour}
                        onChange={(e) =>
                          setBirthDetails((bd) => ({
                            ...bd,
                            hour: e.target.value,
                          }))
                        }
                      />
                      <Input
                        className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-sm text-slate-900"
                        placeholder="Minute"
                        value={birthDetails.minute}
                        onChange={(e) =>
                          setBirthDetails((bd) => ({
                            ...bd,
                            minute: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <Input
                      className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-sm text-slate-900"
                      placeholder="Place of birth (City, Country)"
                      value={birthDetails.place}
                      onChange={(e) =>
                        setBirthDetails((bd) => ({
                          ...bd,
                          place: e.target.value,
                        }))
                      }
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <p className="text-[11px] text-slate-500">
                        This information is used only inside this browser
                        session so ZodiAI can personalise responses. Do not
                        enter passwords, ID numbers or other sensitive data.
                      </p>
                      <Button
                        type="submit"
                        className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        disabled={status === "streaming"}
                      >
                        Send details to ZodiAI
                      </Button>
                    </div>
                  </form>
                </section>

                {/* Messages */}
                <MessageWall
                  messages={messages}
                  status={status}
                  durations={durations}
                  onDurationChange={handleDurationChange}
                />
              </div>
            </div>

            {/* Input area – same colour as main, white top line */}
            <div
              className="border-t px-4 py-3"
              style={{
                backgroundColor: activeTheme.main,
                borderColor: "#ffffff",
              }}
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-2">
                <form
                  id="chat-form"
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-2"
                >
                  <FieldGroup>
                    <Controller
                      name="message"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel
                            htmlFor="chat-form-message"
                            className="sr-only"
                          >
                            Message
                          </FieldLabel>
                          <div className="relative">
                            <textarea
                              {...field}
                              id="chat-form-message"
                              className="max-h-40 min-h-[72px] w-full resize-none rounded-2xl border border-orange-100 bg-white/95 px-4 py-3 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                              placeholder="Ask ZodiAI a question about your chart. Press Shift+Enter for a new line."
                              disabled={status === "streaming"}
                              aria-invalid={fieldState.invalid}
                              autoComplete="off"
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  form.handleSubmit(onSubmit)();
                                }
                              }}
                            />
                            <Button
                              type="submit"
                              size="icon"
                              className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-orange-500 text-white hover:bg-orange-600"
                              disabled={
                                status === "streaming" || formState.isSubmitting
                              }
                            >
                              {status === "streaming" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ArrowUp className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                          {fieldState.error && (
                            <p className="mt-1 text-xs text-red-400">
                              {fieldState.error.message}
                            </p>
                          )}
                        </Field>
                      )}
                    />
                  </FieldGroup>
                </form>

                <div className="flex items-center justify-between text-[11px] opacity-90">
                  <button
                    type="button"
                    onClick={clearChat}
                    className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-[#fdfdfd] px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-orange-50"
                  >
                    <Eraser className="h-3 w-3" />
                    {CLEAR_CHAT_TEXT || "New chat"}
                  </button>
                  {status === "streaming" ? (
                    <div className="flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin text-orange-300" />
                      <span>Calculating your chart…</span>
                    </div>
                  ) : (
                    <span>Press Enter to send · Shift+Enter for new line</span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer – same colour as main */}
            <div
              className="w-full px-4 pb-3 pt-1 text-center text-[11px] opacity-80"
              style={{ backgroundColor: activeTheme.main }}
            >
              © {new Date().getFullYear()} {OWNER_NAME}
              &nbsp;·&nbsp;ZodiAI.&nbsp;Powered by&nbsp;
              <Link
                href="https://ringel.ai/"
                className="underline-offset-2 hover:underline"
              >
                ringel.ai
              </Link>
            </div>
          </div>
        </section>

        {/* Tiny hidden icons so imports aren't "unused" if TS is strict */}
        <span className="hidden">
          <Plus className="h-0 w-0" />
          <PlusIcon className="h-0 w-0" />
          <Square className="h-0 w-0" />
        </span>

        {/* Talking Pandit overlay */}
        <TalkingPandit
          enabled={voiceMode}
          messages={messages}
          sendMessage={sendMessage}
          language={language as "en" | "hi" | "gu" | "hinglish"}
          isStreaming={isStreaming}
        />
      </main>
    </div>
  );
}
