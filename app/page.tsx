"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useChat } from "@ai-sdk/react";
import {
  ArrowUp,
  Loader2,
  Plus,
  Square,
  Sparkles,
  PanelLeft,
  PanelLeftClose,
  Share2,
} from "lucide-react";
import { MessageWall } from "@/components/messages/message-wall";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UIMessage } from "ai";
import {
  useEffect,
  useState,
  useRef,
  FormEvent,
} from "react";
import { AI_NAME, OWNER_NAME, WELCOME_MESSAGE } from "@/config";
import Link from "next/link";

const formSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty.")
    .max(4000, "Message must be at most 4000 characters."),
});

type Lang = "en" | "hi" | "gu";

const STORAGE_KEY = "zodiai-conversations-v1";

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
  messages: UIMessage[];
  durations: Record<string, number>;
  birthDetails?: BirthDetails;
  language: Lang;
  createdAt: number;
  updatedAt: number;
};

type StoredRoot = {
  conversations: Conversation[];
  activeId: string | null;
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

const loadConversationsFromStorage = (): StoredRoot => {
  if (typeof window === "undefined") return { conversations: [], activeId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversations: [], activeId: null };
    const parsed: any = JSON.parse(raw);

    if (Array.isArray(parsed?.conversations)) {
      return {
        conversations: parsed.conversations.map((c: any) => ({
          ...c,
          language: (c.language as Lang) || "en",
        })),
        activeId: parsed.activeId || null,
      };
    }

    // backwards-compat: old single-chat shape
    if (Array.isArray(parsed?.messages)) {
      const conv: Conversation = {
        id: "conv-legacy",
        title: "Previous chat",
        messages: parsed.messages,
        durations: parsed.durations || {},
        birthDetails: EMPTY_BIRTH_DETAILS,
        language: "en",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return { conversations: [conv], activeId: conv.id };
    }

    return { conversations: [], activeId: null };
  } catch (e) {
    console.error("Failed to load conversations:", e);
    return { conversations: [], activeId: null };
  }
};

const saveConversationsToStorage = (
  conversations: Conversation[],
  activeId: string | null
) => {
  if (typeof window === "undefined") return;
  try {
    const data: StoredRoot = { conversations, activeId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save conversations:", e);
  }
};

function createWelcomeMessage(): UIMessage {
  return {
    id: `welcome-${Date.now()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: WELCOME_MESSAGE,
      },
    ],
  };
}

// Flatten message text (for sharing)
function getMessageText(message: UIMessage): string {
  const anyMsg: any = message as any;
  if (typeof anyMsg.content === "string") return anyMsg.content;
  if (Array.isArray(anyMsg.parts)) {
    return anyMsg.parts
      .filter(
        (p: any) => p?.type === "text" && typeof p.text === "string"
      )
      .map((p: any) => p.text)
      .join("");
  }
  return "";
}

export default function Chat() {
  const [isClient, setIsClient] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [durations, setDurations] = useState<Record<string, number>>({});
  const [birthDetails, setBirthDetails] =
    useState<BirthDetails>(EMPTY_BIRTH_DETAILS);
  const [language, setLanguage] = useState<Lang>("en");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const welcomeShownRef = useRef<boolean>(false);

  const { messages, sendMessage, status, stop, setMessages } = useChat();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: "",
    },
  });

  const quickQuestions = [
    {
      label: "Personality & strengths",
      text: "Give me a detailed personality and core strengths overview based on my chart.",
    },
    {
      label: "Career themes",
      text: "What career and learning themes do you see in my chart?",
    },
    {
      label: "Relationships",
      text: "What patterns or tendencies do you see in relationships?",
    },
    {
      label: "This week’s focus",
      text: "What should I focus on this week based on my chart and current energies?",
    },
  ];

  const hasBasicBirthInfo =
    birthDetails.name &&
    birthDetails.day &&
    birthDetails.month &&
    birthDetails.year &&
    birthDetails.place;

  const formatDateShort = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  const startNewConversation = () => {
    const id = `conv-${Date.now()}`;
    const welcome = createWelcomeMessage();
    const conv: Conversation = {
      id,
      title: "New chart",
      messages: [welcome],
      durations: {},
      birthDetails: { ...EMPTY_BIRTH_DETAILS },
      language,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(id);
    setMessages(conv.messages);
    setDurations(conv.durations);
    setBirthDetails(conv.birthDetails!);
    welcomeShownRef.current = true;
  };

  const updateActiveConversation = (
    updater: (conv: Conversation) => Conversation
  ) => {
    if (!activeId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? updater(c) : c))
    );
  };

  // Initial load
  useEffect(() => {
    setIsClient(true);
    const stored = loadConversationsFromStorage();

    if (stored.conversations.length === 0) {
      const id = `conv-${Date.now()}`;
      const welcome = createWelcomeMessage();
      const firstConv: Conversation = {
        id,
        title: "New chart",
        messages: [welcome],
        durations: {},
        birthDetails: { ...EMPTY_BIRTH_DETAILS },
        language: "en",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConversations([firstConv]);
      setActiveId(id);
      setMessages(firstConv.messages);
      setDurations(firstConv.durations);
      setBirthDetails(firstConv.birthDetails!);
      setLanguage("en");
      welcomeShownRef.current = true;
    } else {
      setConversations(stored.conversations);
      const chosenId =
        stored.activeId || stored.conversations[0]?.id || null;
      setActiveId(chosenId);
    }
  }, [setMessages]);

  // When active conversation changes → load its state
  useEffect(() => {
    if (!isClient || !activeId) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;

    setMessages(conv.messages || []);
    setDurations(conv.durations || {});
    setBirthDetails(conv.birthDetails || { ...EMPTY_BIRTH_DETAILS });
    setLanguage(conv.language || "en");
    welcomeShownRef.current = conv.messages.length > 0;
  }, [activeId, conversations, isClient, setMessages]);

  // When messages / durations / birthDetails / language change → update active conv
  useEffect(() => {
    if (!isClient || !activeId) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId
          ? {
              ...c,
              messages,
              durations,
              birthDetails,
              language,
              updatedAt: Date.now(),
            }
          : c
      )
    );
  }, [messages, durations, birthDetails, language, activeId, isClient]);

  // Persist to localStorage
  useEffect(() => {
    if (!isClient) return;
    saveConversationsToStorage(conversations, activeId);
  }, [conversations, activeId, isClient]);

  // Handlers ---------------------------------------------------------

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    sendMessage({ text: data.message, metadata: { language } });
    form.reset();
  };

  const handleBirthSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { name, day, month, year, hour, minute, place } = birthDetails;

    if (!name || !day || !month || !year || !place) {
      toast.error("Please fill at least name, date of birth, and place.");
      return;
    }

    const safeHour = hour || "12";
    const safeMinute = minute || "00";

    // Update conversation title & details
    updateActiveConversation((conv) => ({
      ...conv,
      title: name || conv.title,
      birthDetails: { ...birthDetails },
      language,
    }));

    const text = `My name is ${name}. My date of birth is ${day}-${month}-${year} at ${safeHour}:${safeMinute} (approx). I was born in ${place}. Please use Vedic astrology to interpret my chart and give me an initial overview, then show me a menu of what ZodiAI can help me with.`;

    sendMessage({ text, metadata: { language } });
  };

  const handleDurationChange = (key: string, duration: number) => {
    setDurations((prev) => ({ ...prev, [key]: duration }));
  };

  const handleLanguageChange = (lang: Lang) => {
    setLanguage(lang);
    updateActiveConversation((conv) => ({ ...conv, language: lang }));
  };

  const handleShareChat = async () => {
    if (!messages.length) {
      toast.error("Nothing to share yet.");
      return;
    }

    const text = messages
      .map((m) => {
        const roleLabel = m.role === "user" ? "You" : "ZodiAI";
        return `${roleLabel}: ${getMessageText(m)}`;
      })
      .join("\n\n");

    try {
      if (typeof window !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({
          title: "ZodiAI reading",
          text,
        });
      } else if (
        typeof window !== "undefined" &&
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {
        await navigator.clipboard.writeText(text);
        toast.success("Chat copied to clipboard.");
      } else {
        toast.error("Sharing is not supported in this browser.");
      }
    } catch (err) {
      console.error("Share failed:", err);
      toast.error("Could not share chat.");
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeId);

  // -------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-zinc-50 text-slate-900 flex">
      {/* LEFT SIDEBAR (collapsible) */}
      <aside
        className={`hidden md:flex flex-col border-r border-slate-200 bg-white transition-all duration-200 ${
          sidebarOpen ? "w-64" : "w-12"
        }`}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Avatar className="size-7 border border-orange-200 bg-orange-50">
                <AvatarImage src="/logo.png" />
                <AvatarFallback>Z</AvatarFallback>
              </Avatar>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">ZodiAI</span>
                <span className="text-[11px] text-slate-500">
                  Saved readings
                </span>
              </div>
            </div>
          )}
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7 border-slate-300 bg-white hover:bg-slate-100"
            onClick={startNewConversation}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 text-sm">
          {sidebarOpen ? (
            conversations.length === 0 ? (
              <div className="text-xs text-slate-500 px-2 py-2">
                No chats yet. Start a new chart reading.
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.id === activeId;
                const bd = conv.birthDetails;
                const subtitle = bd
                  ? `${bd.name || "Unnamed"} · ${
                      bd.day && bd.month && bd.year
                        ? `${bd.day}-${bd.month}-${bd.year}`
                        : "DOB not set"
                    }`
                  : "Birth details not set";

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => setActiveId(conv.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      isActive
                        ? "bg-orange-50 border border-orange-200"
                        : "hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">
                        {conv.title || "New chart"}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {formatDateShort(conv.updatedAt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {subtitle}
                    </div>
                  </button>
                );
              })
            )
          ) : (
            <div className="flex flex-col items-center mt-6 gap-1 text-[10px] text-slate-500">
              <span className="rotate-90">Chats</span>
            </div>
          )}
        </div>
      </aside>

      {/* RIGHT PANEL */}
      <main className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between px-4 py-3 max-w-5xl mx-auto">
            {/* Left: sidebar toggle */}
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 border-slate-300 bg-white hover:bg-slate-100"
                onClick={() => setSidebarOpen((v) => !v)}
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeft className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Center: title */}
            <div className="flex flex-col items-center leading-tight text-center">
              <p className="tracking-tight text-sm font-semibold">
                {activeConversation?.title || "ZodiAI chat"}
              </p>
              <span className="text-[11px] text-slate-500">
                Feels like talking to a friendly astrologer, not a robot.
              </span>
            </div>

            {/* Right: language + share + logo */}
            <div className="flex items-center gap-3">
              <select
                value={language}
                onChange={(e) =>
                  handleLanguageChange(e.target.value as Lang)
                }
                className="bg-white border border-slate-300 text-[11px] rounded-md px-2 py-1 text-slate-800 focus:outline-none focus:ring-1 focus:ring-orange-500"
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
                <option value="gu">ગુજરાતી</option>
              </select>

              <Button
                size="sm"
                variant="outline"
                className="border-slate-300 bg-white hover:bg-slate-100 text-xs flex items-center gap-1.5"
                onClick={handleShareChat}
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </Button>

              <Avatar className="size-8 border border-orange-200 bg-orange-50">
                <AvatarImage src="/logo.png" />
                <AvatarFallback>Z</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* Middle: chat area */}
        <div className="flex-1 flex flex-col items-center px-4 py-4">
          <div
            id="chat-scroll-container"
            className="w-full max-w-3xl flex-1 overflow-y-auto space-y-4 pb-4"
          >
            {/* Birth details card */}
            <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4 space-y-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-orange-500" />
                    Enter your birth details
                  </h2>
                  <p className="text-[11px] text-slate-600">
                    ZodiAI uses your birth data to call AstrologyAPI and
                    interpret your chart. Approximate time is okay.
                  </p>
                </div>

                {hasBasicBirthInfo && (
                  <div className="hidden sm:flex flex-col items-start text-[11px] text-slate-800 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 leading-snug space-y-1">
                    <span className="uppercase tracking-wide text-[10px] text-orange-600">
                      Preview
                    </span>
                    <span className="font-medium">{birthDetails.name}</span>
                    <span>
                      {birthDetails.day}-{birthDetails.month}-
                      {birthDetails.year}
                      {birthDetails.hour &&
                        ` · ${birthDetails.hour}:${
                          birthDetails.minute || "00"
                        }`}
                    </span>
                    <span className="truncate max-w-[180px]">
                      {birthDetails.place}
                    </span>
                  </div>
                )}
              </div>

              <form
                onSubmit={handleBirthSubmit}
                className="grid gap-2 sm:grid-cols-2 mt-1"
              >
                <div className="sm:col-span-2">
                  <Input
                    className="bg-white border-slate-300 text-slate-900"
                    placeholder="Name"
                    value={birthDetails.name}
                    onChange={(e) =>
                      setBirthDetails((bd) => ({
                        ...bd,
                        name: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="flex gap-2">
                  <Input
                    className="bg-white border-slate-300 text-slate-900"
                    placeholder="DD"
                    value={birthDetails.day}
                    onChange={(e) =>
                      setBirthDetails((bd) => ({ ...bd, day: e.target.value }))
                    }
                  />
                  <Input
                    className="bg-white border-slate-300 text-slate-900"
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
                    className="bg-white border-slate-300 text-slate-900"
                    placeholder="YYYY"
                    value={birthDetails.year}
                    onChange={(e) =>
                      setBirthDetails((bd) => ({
                        ...bd,
                        year: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="flex gap-2">
                  <Input
                    className="bg-white border-slate-300 text-slate-900"
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
                    className="bg-white border-slate-300 text-slate-900"
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

                <div className="sm:col-span-2">
                  <Input
                    className="bg-white border-slate-300 text-slate-900"
                    placeholder="Place of birth (City, Country)"
                    value={birthDetails.place}
                    onChange={(e) =>
                      setBirthDetails((bd) => ({
                        ...bd,
                        place: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="sm:col-span-2 flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={status === "streaming" || status === "submitted"}
                    className="bg-orange-500 hover:bg-orange-600 text-xs text-white"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Send details to {AI_NAME}
                  </Button>
                </div>
              </form>

              <p className="text-[11px] text-slate-500">
                This information stays in this browser session and is used only
                to personalize responses. Please don&apos;t enter passwords or
                ID numbers.
              </p>
            </section>

            {/* Messages */}
            {isClient ? (
              <>
                <MessageWall
                  messages={messages}
                  status={status}
                  durations={durations}
                  onDurationChange={handleDurationChange}
                />
                {status === "submitted" && (
                  <div className="flex justify-start max-w-3xl w-full mt-2">
                    <Loader2 className="size-4 animate-spin text-slate-400" />
                  </div>
                )}
              </>
            ) : (
              <div className="flex justify-center max-w-2xl w-full mt-6">
                <Loader2 className="size-4 animate-spin text-slate-400" />
              </div>
            )}
          </div>

          {/* Bottom input bar */}
          <div className="w-full max-w-3xl mt-3">
            {/* Quick asks */}
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
              <span className="mr-1">Quick asks:</span>
              {quickQuestions.map((q) => (
                <Button
                  key={q.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px] border-slate-300 bg-white hover:bg-slate-50"
                  onClick={() =>
                    sendMessage({ text: q.text, metadata: { language } })
                  }
                  disabled={status === "streaming" || status === "submitted"}
                >
                  {q.label}
                </Button>
              ))}
            </div>

            {/* Chat input (multiline) */}
            <form id="chat-form" onSubmit={form.handleSubmit(onSubmit)}>
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
                          className="w-full min-h-[60px] max-h-40 resize-none pr-14 pl-5 py-3 bg-white border border-slate-300 rounded-[20px] text-sm leading-relaxed text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 placeholder:text-slate-400"
                          placeholder="Ask ZodiAI a question…  (Shift+Enter for new line, Enter to send)"
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

                        {(status === "ready" || status === "error") && (
                          <Button
                            className="absolute right-3 top-2.5 rounded-full h-9 w-9 bg-orange-500 hover:bg-orange-600 text-white"
                            type="submit"
                            disabled={!field.value.trim()}
                            size="icon"
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                        )}
                        {(status === "streaming" || status === "submitted") && (
                          <Button
                            className="absolute right-3 top-2.5 rounded-full h-9 w-9 bg-slate-200 hover:bg-slate-300 border border-slate-400"
                            size="icon"
                            type="button"
                            onClick={() => {
                              stop();
                            }}
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
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500 flex flex-col items-center gap-1 bg-white/70">
          <div>
            © {new Date().getFullYear()} {OWNER_NAME} ·{" "}
            <Link href="/terms" className="underline">
              Terms of Use
            </Link>{" "}
            · Powered by{" "}
            <Link href="https://ringel.ai/" className="underline">
              Ringel.AI
            </Link>
          </div>
          <div>
            Astrology offers guidance, not fixed destiny. Use ZodiAI for
            reflection, and consult professionals for medical, legal or
            financial decisions.
          </div>
        </footer>
      </main>
    </div>
  );
}
