"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useChat } from "@ai-sdk/react";
import { ArrowUp, Eraser, Loader2, Plus, PlusIcon, Square } from "lucide-react";
import { MessageWall } from "@/components/messages/message-wall";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UIMessage } from "ai";
import { useEffect, useState, useRef } from "react";
import { AI_NAME, CLEAR_CHAT_TEXT, OWNER_NAME, WELCOME_MESSAGE } from "@/config";
import Image from "next/image";
import Link from "next/link";

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

type StorageData = {
  messages: UIMessage[];
  durations: Record<string, number>;
};

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

export default function Chat() {
  const [isClient, setIsClient] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const welcomeMessageShownRef = useRef<boolean>(false);

  // Profile & preferences
  const [userName, setUserName] = useState<string>("");
  const [language, setLanguage] = useState<Language>("en");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Load stored messages on first render (SSR-safe)
  const stored =
    typeof window !== "undefined"
      ? loadMessagesFromStorage()
      : { messages: [], durations: {} };

  const [initialMessages] = useState<UIMessage[]>(stored.messages);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    messages: initialMessages,
  });

  // Initial client-only setup
  useEffect(() => {
    setIsClient(true);
    setDurations(stored.durations);
    setMessages(stored.messages);

    // Load profile preferences
    if (typeof window !== "undefined") {
      try {
        const savedName = localStorage.getItem(USER_NAME_KEY);
        const savedLang = localStorage.getItem(LANGUAGE_KEY) as Language | null;
        if (savedName) setUserName(savedName);
        if (savedLang === "en" || savedLang === "hi" || savedLang === "gu") {
          setLanguage(savedLang);
        }
      } catch (error) {
        console.error("Failed to load user profile:", error);
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

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const langPrefix =
      language === "hi"
        ? "[Language: Hindi] "
        : language === "gu"
        ? "[Language: Gujarati] "
        : "[Language: English] ";

    const namePrefix = userName ? `User name: ${userName}. ` : "";

    const fullText = `${langPrefix}${namePrefix}${data.message}`;

    sendMessage({ text: fullText });
    form.reset();
  };

  const clearChat = () => {
    const newMessages: UIMessage[] = [];
    const newDurations: Record<string, number> = {};
    setMessages(newMessages);
    setDurations(newDurations);
    saveMessagesToStorage(newMessages, newDurations);
    toast.success("Chat cleared");
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

  const sidebarSummary = userName
    ? `Stored locally for ${userName}. Only you can see this chat on this browser.`
    : "Add your name to personalise your reading. Your chats stay only in this browser.";

  const formState = form.formState;

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-orange-50/10 to-white text-slate-900">
      <main className="mx-auto flex h-screen max-w-6xl flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-orange-100 bg-white/70 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100 transition"
            >
              {sidebarOpen ? "Hide panel" : "Show panel"}
            </button>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight text-slate-900">
                ZodiAI · {AI_NAME}
              </span>
              <span className="text-[11px] text-slate-500">
                Gentle Vedic insights — not deterministic predictions.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Language selector (desktop) */}
            <div className="hidden items-center gap-2 rounded-full border border-orange-200 bg-orange-50/80 px-3 py-1 text-[11px] text-slate-700 sm:flex">
              <span className="font-medium text-orange-700">Language</span>
              <select
                className="bg-transparent text-[11px] text-slate-800 outline-none"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
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
              className="hidden rounded-full border-orange-200 bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-orange-50 sm:inline-flex"
              onClick={handleShareChat}
            >
              Share chat
            </Button>

            <Avatar className="size-9 bg-orange-50 ring-1 ring-orange-200">
              <AvatarImage src="/logo.png" />
              <AvatarFallback>
                <Image src="/logo.png" alt="ZodiAI" width={36} height={36} />
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar */}
          {sidebarOpen && (
            <aside className="hidden h-full w-64 flex-shrink-0 flex-col border-r border-orange-100 bg-white/80 px-3 py-4 text-xs text-slate-700 sm:flex">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">
                  Your session
                </p>
              </div>

              <FieldGroup className="space-y-3">
                <Field>
                  <FieldLabel
                    htmlFor="user-name"
                    className="text-[11px] text-slate-600"
                  >
                    Name
                  </FieldLabel>
                  <Input
                    id="user-name"
                    placeholder="Type your name"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="h-8 rounded-xl border-orange-100 bg-white/90 px-3 text-xs"
                  />
                </Field>

                <Field>
                  <FieldLabel className="text-[11px] text-slate-600">
                    Language
                  </FieldLabel>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setLanguage("en")}
                      className={`flex-1 rounded-full px-2 py-1 text-[11px] ${
                        language === "en"
                          ? "bg-orange-500 text-white"
                          : "bg-orange-50 text-slate-700"
                      }`}
                    >
                      English
                    </button>
                    <button
                      type="button"
                      onClick={() => setLanguage("hi")}
                      className={`flex-1 rounded-full px-2 py-1 text-[11px] ${
                        language === "hi"
                          ? "bg-orange-500 text-white"
                          : "bg-orange-50 text-slate-700"
                      }`}
                    >
                      हिंदी
                    </button>
                    <button
                      type="button"
                      onClick={() => setLanguage("gu")}
                      className={`flex-1 rounded-full px-2 py-1 text-[11px] ${
                        language === "gu"
                          ? "bg-orange-500 text-white"
                          : "bg-orange-50 text-slate-700"
                      }`}
                    >
                      ગુજરાતી
                    </button>
                  </div>
                </Field>
              </FieldGroup>

              <div className="mt-5 rounded-xl border border-orange-100 bg-orange-50/70 p-3 text-[11px] leading-relaxed">
                <p className="font-medium text-orange-800">How ZodiAI helps</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>Birth-chart based life themes</li>
                  <li>Upcoming planetary periods</li>
                  <li>Context for daily decisions</li>
                </ul>
              </div>

              <p className="mt-3 text-[10px] text-slate-500">{sidebarSummary}</p>
            </aside>
          )}

          {/* Main chat area */}
          <section className="flex flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-3 flex justify-center">
              <div className="w-full max-w-3xl">
                <MessageWall
                  messages={messages}
                  status={status}
                  durations={durations}
                  onDurationChange={handleDurationChange}
                />
              </div>
            </div>

            {/* Input area */}
            <div className="border-t border-orange-100 bg-white/90 px-4 py-3">
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
                              className="w-full min-h-[72px] max-h-40 resize-none rounded-2xl border border-orange-100 bg-white/90 px-4 py-3 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                              placeholder="Share your birth details and question. Press Shift+Enter for a new line."
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
                            <p className="mt-1 text-xs text-red-500">
                              {fieldState.error.message}
                            </p>
                          )}
                        </Field>
                      )}
                    />
                  </FieldGroup>
                </form>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <button
                    type="button"
                    onClick={clearChat}
                    className="inline-flex items-center gap-1 rounded-full border border-orange-100 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-orange-50"
                  >
                    <Eraser className="h-3 w-3" />
                    {CLEAR_CHAT_TEXT}
                  </button>
                  {status === "streaming" ? (
                    <div className="flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin text-orange-500" />
                      <span>Calculating your chart…</span>
                    </div>
                  ) : (
                    <span>Press Enter to send · Shift+Enter for new line</span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="w-full px-4 pb-3 pt-1 text-center text-[11px] text-slate-500">
              © {new Date().getFullYear()} {OWNER_NAME}
              &nbsp;·&nbsp;ZodiAI.&nbsp;Powered by&nbsp;
              <Link
                href="https://ringel.ai/"
                className="underline-offset-2 hover:underline"
              >
                ringel.ai
              </Link>
            </div>
          </section>
        </div>

        {/* Tiny hidden icons so imports aren't "unused" if your TS config is strict */}
        <span className="hidden">
          <Plus className="h-0 w-0" />
          <PlusIcon className="h-0 w-0" />
          <Square className="h-0 w-0" />
        </span>
      </main>
    </div>
  );
}
