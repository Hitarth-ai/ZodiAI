"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useChat } from "@ai-sdk/react";
import { ArrowUp, Loader2, Plus, Square } from "lucide-react";
import { MessageWall } from "@/components/messages/message-wall";
import { ChatHeader } from "@/app/parts/chat-header";
import { ChatHeaderBlock } from "@/app/parts/chat-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UIMessage } from "ai";
import { useEffect, useState, useRef, FormEvent } from "react";
import {
  AI_NAME,
  CLEAR_CHAT_TEXT,
  OWNER_NAME,
  WELCOME_MESSAGE,
} from "@/config";
import Image from "next/image";
import Link from "next/link";

const formSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty.")
    .max(4000, "Message must be at most 4000 characters."),
});

const STORAGE_KEY = "chat-messages";

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

const loadMessagesFromStorage = (): StorageData => {
  if (typeof window === "undefined") return { messages: [], durations: {} };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { messages: [], durations: {} };
    const parsed = JSON.parse(stored);
    return {
      messages: parsed.messages || [],
      durations: parsed.durations || {},
    };
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

export default function Chat() {
  const [isClient, setIsClient] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [birthDetails, setBirthDetails] = useState<BirthDetails>({
    name: "",
    day: "",
    month: "",
    year: "",
    hour: "",
    minute: "",
    place: "",
  });

  const welcomeMessageShownRef = useRef<boolean>(false);

  const stored =
    typeof window !== "undefined"
      ? loadMessagesFromStorage()
      : { messages: [], durations: {} };
  const [initialMessages] = useState<UIMessage[]>(stored.messages);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    messages: initialMessages,
  });

  useEffect(() => {
    setIsClient(true);
    setDurations(stored.durations);
    setMessages(stored.messages);
  }, []);

  useEffect(() => {
    if (isClient) {
      saveMessagesToStorage(messages, durations);
    }
  }, [durations, messages, isClient]);

  const handleDurationChange = (key: string, duration: number) => {
    setDurations((prevDurations) => {
      const newDurations = { ...prevDurations };
      newDurations[key] = duration;
      return newDurations;
    });
  };

  useEffect(() => {
    if (
      isClient &&
      initialMessages.length === 0 &&
      !welcomeMessageShownRef.current
    ) {
      const welcomeMessage: UIMessage = {
        id: `welcome-${Date.now()}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: WELCOME_MESSAGE,
          },
        ],
      };
      setMessages([welcomeMessage]);
      saveMessagesToStorage([welcomeMessage], {});
      welcomeMessageShownRef.current = true;
    }
  }, [isClient, initialMessages.length, setMessages]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: "",
    },
  });

  function onSubmit(data: z.infer<typeof formSchema>) {
    sendMessage({ text: data.message });
    form.reset();
  }

  function clearChat() {
    const newMessages: UIMessage[] = [];
    const newDurations: Record<string, number> = {};
    setMessages(newMessages);
    setDurations(newDurations);
    saveMessagesToStorage(newMessages, newDurations);
    toast.success("Chat cleared");
  }

  function handleBirthSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { name, day, month, year, hour, minute, place } = birthDetails;

    if (!name || !day || !month || !year || !place) {
      toast.error("Please fill at least name, date of birth, and place.");
      return;
    }

    const safeHour = hour || "12";
    const safeMinute = minute || "00";

    const text = `My name is ${name}. My date of birth is ${day}-${month}-${year} at ${safeHour}:${safeMinute} (approx). I was born in ${place}. Please use Vedic astrology to interpret my chart and give me an initial overview, then show me a menu of what ZodiAI can help me with.`;

    sendMessage({ text });
  }

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

  return (
    <div className="flex h-screen items-center justify-center font-sans dark:bg-black">
      <main className="w-full dark:bg-black h-screen relative">
        {/* Top header */}
        <div className="fixed top-0 left-0 right-0 z-50 bg-linear-to-b from-background via-background/50 to-transparent dark:bg-black overflow-visible pb-16">
          <div className="relative overflow-visible">
            <ChatHeader>
              <ChatHeaderBlock />
              <ChatHeaderBlock className="justify-center items-center gap-2">
                <Avatar className="size-8 ring-1 ring-primary">
                  <AvatarImage src="/logo.png" />
                  <AvatarFallback>
                    <Image src="/logo.png" alt="Logo" width={36} height={36} />
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col leading-tight">
                  <p className="tracking-tight text-sm">Chat with {AI_NAME}</p>
                  <span className="text-[11px] text-muted-foreground">
                    Vedic astrology assistant powered by AI
                  </span>
                </div>
              </ChatHeaderBlock>
              <ChatHeaderBlock className="justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  onClick={clearChat}
                >
                  <Plus className="size-4" />
                  {CLEAR_CHAT_TEXT}
                </Button>
              </ChatHeaderBlock>
            </ChatHeader>
          </div>
        </div>

        {/* Main scrollable area */}
        <div className="h-screen overflow-y-auto px-5 py-4 w-full pt-[88px] pb-[250px]">
          <div className="flex flex-col items-center justify-end min-h-full">
            {isClient ? (
              <>
                {/* Birth details card */}
                <div className="w-full max-w-3xl mb-4">
                  <div className="rounded-2xl border border-border bg-card/80 p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold">
                        Step 1 · Enter your birth details
                      </h2>
                      <span className="text-[11px] text-muted-foreground">
                        Used only to call AstrologyAPI
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      ZodiAI uses your date, time and place of birth to call
                      Vedic astrology APIs and interpret your chart. If you
                      don&apos;t know the exact time, an approximate hour is ok.
                    </p>

                    <form
                      onSubmit={handleBirthSubmit}
                      className="grid gap-2 sm:grid-cols-2"
                    >
                      <div className="sm:col-span-2">
                        <Input
                          className="bg-background"
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
                          className="bg-background"
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
                          className="bg-background"
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
                          className="bg-background"
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
                          className="bg-background"
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
                          className="bg-background"
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
                          className="bg-background"
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
                          disabled={
                            status === "streaming" || status === "submitted"
                          }
                        >
                          Send details to {AI_NAME}
                        </Button>
                      </div>
                    </form>

                    <p className="text-[11px] text-muted-foreground">
                      This information is used only inside this browser session
                      so {AI_NAME} can personalize responses. Do not enter
                      passwords, ID numbers or other sensitive data.
                    </p>
                  </div>
                </div>

                <MessageWall
                  messages={messages}
                  status={status}
                  durations={durations}
                  onDurationChange={handleDurationChange}
                />
                {status === "submitted" && (
                  <div className="flex justify-start max-w-3xl w-full">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </>
            ) : (
              <div className="flex justify-center max-w-2xl w-full">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        {/* Bottom input + quick actions + footer */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-linear-to-t from-background via-background/50 to-transparent dark:bg-black overflow-visible pt-13">
          <div className="w-full px-5 pt-5 pb-1 items-center flex justify-center relative overflow-visible">
            <div className="message-fade-overlay" />
            <div className="max-w-3xl w-full">
              {/* Quick action chips */}
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="mr-1">Quick asks:</span>
                {quickQuestions.map((q) => (
                  <Button
                    key={q.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => sendMessage({ text: q.text })}
                    disabled={status === "streaming" || status === "submitted"}
                  >
                    {q.label}
                  </Button>
                ))}
              </div>

              {/* Chat input */}
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
                            className="w-full min-h-[56px] max-h-40 resize-none pr-14 pl-5 py-3 bg-card rounded-[20px] text-sm leading-relaxed border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
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
                              className="absolute right-3 top-2.5 rounded-full h-9 w-9"
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
                              className="absolute right-3 top-2.5 rounded-full h-9 w-9"
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

          {/* Footer text */}
          <div className="w-full px-5 py-3 items-center flex flex-col gap-1 justify-center text-[11px] text-muted-foreground">
            <div>
              © {new Date().getFullYear()} {OWNER_NAME}{" "}
              <Link href="/terms" className="underline">
                Terms of Use
              </Link>{" "}
              Powered by{" "}
              <Link href="https://ringel.ai/" className="underline">
                Ringel.AI
              </Link>
            </div>
            <div>
              Astrology offers guidance, not fixed destiny. Use ZodiAI for
              reflection, and consult qualified professionals for medical,
              legal or financial decisions.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
