"use client";

import { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";

// Must match the id on the scrollable div in page.tsx
const SCROLL_CONTAINER_ID = "chat-scroll-container";

type MessageWallProps = {
  messages: UIMessage[];
  status?: string;
  durations?: Record<string, number>;
  onDurationChange?: (key: string, duration: number) => void;
};

export function MessageWall({
  messages,
  status,
  durations,
  onDurationChange,
}: MessageWallProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Track whether user is near the bottom of the main scroll container
  useEffect(() => {
    if (typeof window === "undefined") return;

    const container = document.getElementById(SCROLL_CONTAINER_ID);
    if (!container) return;

    const handleScroll = () => {
      const threshold = 80; // px from bottom counts as "at bottom"
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;

      setIsAtBottom(distanceFromBottom < threshold);
    };

    handleScroll(); // initial
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll only when user is already at the bottom
  useEffect(() => {
    if (!isAtBottom) return;
    if (typeof window === "undefined") return;

    const container = document.getElementById(SCROLL_CONTAINER_ID);
    if (!container) return;

    container.scrollTop = container.scrollHeight;
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, isAtBottom]);

  return (
    <div className="relative max-w-3xl w-full">
      <div className="relative flex flex-col gap-4">
        {messages.map((message, idx) => {
          const isLastMessage = idx === messages.length - 1;
          return (
            <div key={message.id} className="w-full">
              {message.role === "user" ? (
                <UserMessage message={message} />
              ) : (
                <AssistantMessage
                  message={message}
                  status={status}
                  isLastMessage={isLastMessage}
                  durations={durations}
                  onDurationChange={onDurationChange}
                />
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
