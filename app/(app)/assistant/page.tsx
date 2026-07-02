"use client"

import { AgentChat, createAgentChat } from "@21st-sdk/nextjs"
import { useChat } from "@ai-sdk/react"
import theme from "@/app/theme.json"

const chat = createAgentChat({
  agent: "my-agent",
  tokenUrl: "/api/an-token",
})

export default function AssistantPage() {
  const { messages, sendMessage, status, stop, error } = useChat({ chat })

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h1 className="text-lg font-semibold">FINNO AI Assistant</h1>
        <p className="text-sm text-muted-foreground">Powered by 21st SDK</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <AgentChat
          messages={messages}
          onSend={(msg) => sendMessage({ text: msg.content })}
          status={status}
          onStop={stop}
          error={error ?? undefined}
          theme={theme}
        />
      </div>
    </div>
  )
}
