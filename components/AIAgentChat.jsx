"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Loader2, Mic, MicOff } from "lucide-react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import toast from "react-hot-toast";
import { usePathname } from "next/navigation";
import axios from "axios";

// ---- Small helpers -------------------------------------------------------

// Escape raw HTML first so nothing from the webhook response can inject
// tags/scripts. Only AFTER escaping do we turn URLs into safe <a> links.
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMessageText(text) {
  if (!text) return "";
  const escaped = escapeHtml(text);
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const withLinks = escaped.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 underline break-all">${url}</a>`;
  });
  return withLinks.replace(/\n/g, "<br />");
}

let idCounter = 0;
const nextId = () => `msg-${Date.now()}-${idCounter++}`;

export default function AIAgentChat() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const [language, setLanguage] = useState("en-US");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef(null);
  const voicesRef = useRef([]);

  // Feature support flags — computed once, used to disable/hide UI instead
  // of letting unsupported browsers throw at runtime.
  const [speechRecognitionSupported, setSpeechRecognitionSupported] =
    useState(false);
  const [speechSynthesisSupported, setSpeechSynthesisSupported] =
    useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Safe wrappers — every call site uses these instead of touching
  // window.speechSynthesis / recognitionRef directly, so a missing API
  // never throws.
  const cancelSpeech = useCallback(() => {
    if (speechSynthesisSupported) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, [speechSynthesisSupported]);

  const stopRecognition = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // Detect support + load voices (with retry, since getVoices() can return
  // an empty array before the browser has finished loading them, and
  // onvoiceschanged doesn't fire reliably on every browser/OS).
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hasSynthesis = "speechSynthesis" in window;
    setSpeechSynthesisSupported(hasSynthesis);

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechRecognitionSupported(!!SpeechRecognitionCtor);

    if (!hasSynthesis) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length) voicesRef.current = voices;
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    // Fallback: some browsers (older Safari/WebKit) never fire
    // onvoiceschanged. Poll briefly as a backstop.
    let attempts = 0;
    const pollId = setInterval(() => {
      attempts += 1;
      if (voicesRef.current.length || attempts > 10) {
        clearInterval(pollId);
        return;
      }
      loadVoices();
    }, 300);

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      clearInterval(pollId);
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, isLoading]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        if (speechSynthesisSupported) window.speechSynthesis.cancel();
        recognitionRef.current?.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!speechRecognitionSupported) return;

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);

    recognition.onerror = (event) => {
      // "no-speech" / "aborted" happen routinely (user stayed silent, or we
      // stopped it ourselves) — don't scare the user with a toast for those.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        toast.error(`Voice input error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setMessage(transcript);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, [language, speechRecognitionSupported]);

  // Hide on auth pages
  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/signin"
  ) {
    return null;
  }

  const speakText = (text) => {
    if (!speechSynthesisSupported || !text) return;

    window.speechSynthesis.cancel();
    setIsSpeaking(false);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    const voices = voicesRef.current;
    let selectedVoice;

    if (language === "ur-PK") {
      selectedVoice =
        voices.find((v) => v.lang === "ur-PK") ||
        voices.find((v) => v.lang.startsWith("ur"));
      if (!selectedVoice) {
        // No Urdu voice on this device — tell the user instead of silently
        // reading Urdu text with a mismatched voice.
        toast("No Urdu voice found on this device — showing text only.", {
          icon: "🔇",
        });
        return;
      }
    } else {
      selectedVoice =
        voices.find((v) => v.lang.toLowerCase() === language.toLowerCase()) ||
        voices.find((v) =>
          v.lang.toLowerCase().startsWith(language.split("-")[0].toLowerCase()),
        );
    }

    if (selectedVoice) utterance.voice = selectedVoice;
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async () => {
    cancelSpeech();

    if (!message.trim()) {
      toast.error("Please enter a message");
      return;
    }

    setIsLoading(true);
    const userMessage = message.trim();

    setChatHistory((prev) => [
      ...prev,
      { id: nextId(), type: "user", text: userMessage, timestamp: new Date() },
    ]);

    setMessage("");

    try {
      const response = await axios.post(
        "https://hook.eu1.make.com/dkhdswo943eo1zqded5h9pwttjl63l4u",
        { message: userMessage },
        { headers: { "Content-Type": "application/json" } },
      );

      if (response.status === 200) {
        const data = response.data;

        if (data && data.response) {
          setChatHistory((prev) => [
            ...prev,
            {
              id: nextId(),
              type: "agent",
              text: data.response,
              timestamp: new Date(),
            },
          ]);

          const cleanText = data.response.replace(/https?:\/\/\S+/g, "");
          speakText(cleanText);
        } else {
          setChatHistory((prev) => [
            ...prev,
            {
              id: nextId(),
              type: "agent",
              text: "Thank you! Our AI agent has received your message and will process your request shortly.",
              timestamp: new Date(),
            },
          ]);
          toast.success("Message sent successfully!");
        }
      } else {
        throw new Error("Failed to send message");
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message. Please try again.");

      setChatHistory((prev) => [
        ...prev,
        {
          id: nextId(),
          type: "error",
          text: "Sorry, there was an error sending your message. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startListening = () => {
    cancelSpeech();

    if (!speechRecognitionSupported || !recognitionRef.current) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }

    if (isListening) return;

    try {
      recognitionRef.current.start();
    } catch (err) {
      console.log(err);
    }
  };

  const stopListening = () => {
    stopRecognition();
  };

  return (
    <>
      {/* Floating Chat Button */}
      <motion.div
        className="fixed bottom-24 sm:bottom-6 right-6 z-50"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: "spring", stiffness: 260, damping: 20 }}
      >
        <Button
          isIconOnly
          color="primary"
          size="lg"
          className="w-16 h-16 rounded-full shadow-2xl"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <MessageCircle className="w-6 h-6" />
          )}
        </Button>
      </motion.div>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-48 sm:bottom-28 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]"
          >
            <div className="bg-white dark:bg-brand-deepdark rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-brand-white dark:bg-brand-deepdark p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-primary rounded-full flex items-center justify-center">
                    <MessageCircle className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-brand-dark text-lg dark:text-white poppins_medium">
                      Luxora AI
                    </h3>
                    <p className="text-brand-dark/80 text-xs dark:text-white/80 poppins_regular">
                      {isSpeaking
                        ? "🔊 Speaking..."
                        : isListening
                          ? "🎤 Listening..."
                          : "Your AI Property Assistant"}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      cancelSpeech();
                      stopRecognition();
                      setIsListening(false);
                      setIsOpen(false);
                    }}
                    className="text-brand-dark/80 dark:text-white/80 dark:hover:text-white hover:text-brand-dark transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="h-[350px] overflow-y-auto p-4 space-y-4 bg-brand-light dark:bg-brand-dark">
                {chatHistory.length === 0 && (
                  <div className="flex items-start gap-2">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <MessageCircle className="w-4 h-4 text-white" />
                    </div>
                    <div className="bg-white dark:bg-gray-700 rounded-2xl rounded-tl-none p-3 max-w-[80%]">
                      <p className="text-sm text-gray-800 dark:text-gray-200">
                        👋 Hi! I'm Luxora AI, your property assistant. How can I
                        help you find your dream home today?
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Try: "I'm looking for a 4 bedroom house"
                      </p>
                    </div>
                  </div>
                )}

                {chatHistory.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2 ${
                      msg.type === "user" ? "flex-row-reverse" : ""
                    }`}
                  >
                    {msg.type !== "user" && (
                      <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <MessageCircle className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div
                      className={`rounded-2xl p-3 max-w-[80%] ${
                        msg.type === "user"
                          ? "bg-blue-600 text-white rounded-tr-none"
                          : msg.type === "error"
                            ? "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-tl-none"
                            : "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-tl-none"
                      }`}
                    >
                      {msg.type === "agent" ? (
                        <p
                          className="text-sm whitespace-pre-wrap poppins_regular"
                          dangerouslySetInnerHTML={{
                            __html: formatMessageText(msg.text),
                          }}
                        />
                      ) : (
                        <p className="text-sm whitespace-pre-wrap poppins_regular">
                          {msg.text}
                        </p>
                      )}
                      <p className="text-xs opacity-60 mt-1 roboto_regular">
                        {msg.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex items-start gap-2">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <MessageCircle className="w-4 h-4 text-white" />
                    </div>
                    <div className="bg-white dark:bg-gray-700 rounded-2xl rounded-tl-none p-3">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span className="text-sm text-gray-600 dark:text-gray-300 poppins_regular">
                          Processing...
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-2 bg-white dark:bg-brand-dark border-t border-gray-200 dark:border-brand-dark">
                <div className="flex items-end gap-2">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="border rounded-lg px-2 py-2 text-sm"
                  >
                    <option value="en-US">EN</option>
                    <option value="ur-PK">اردو</option>
                  </select>

                  <Button
                    isIconOnly
                    disabled={isSpeaking || !speechRecognitionSupported}
                    title={
                      !speechRecognitionSupported
                        ? "Voice input not supported in this browser"
                        : undefined
                    }
                    onClick={isListening ? stopListening : startListening}
                    className={`${
                      isListening
                        ? "bg-red-500"
                        : isSpeaking || !speechRecognitionSupported
                          ? "bg-gray-400 cursor-not-allowed"
                          : "bg-green-600"
                    } text-white`}
                  >
                    {isListening ? (
                      <MicOff className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </Button>

                  <Input
                    placeholder={
                      isListening ? "Listening..." : "Type or speak..."
                    }
                    value={message}
                    onChange={(e) => {
                      if (isSpeaking) cancelSpeech();
                      setMessage(e.target.value);
                    }}
                    onKeyDown={handleKeyPress}
                    disabled={isLoading}
                    className="flex-1"
                    classNames={{
                      input:
                        "text-sm bg-transparent outline-none poppins_regular",
                      inputWrapper: "bg-transparent transition-colors",
                    }}
                  />

                  <Button
                    isIconOnly
                    onClick={sendMessage}
                    disabled={isLoading || isSpeaking || !message.trim()}
                    className="bg-brand-primary"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
