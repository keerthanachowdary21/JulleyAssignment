import React, { useState } from 'react';
import { Bot, Send, X } from 'lucide-react';
import { apiRequest } from '../services/api.ts';
import type { Board, Tenant } from '../types.ts';

interface AiAssistantDrawerProps {
  open: boolean;
  tenant: Tenant | null;
  board: Board | null;
  onClose: () => void;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolsUsed?: string[];
  mode?: string;
}

const SUGGESTED_PROMPTS = [
  'Summarize the current board progress and completion rate.',
  'Which tasks are overdue in this branch?',
  'Summarize recent collaboration activity.',
  'What are the highest priority tasks right now?',
];

export function AiAssistantDrawer({ open, tenant, board, onClose }: AiAssistantDrawerProps) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ChatTurn[]>([]);

  if (!open || !tenant) return null;

  async function askQuestion(promptText: string) {
    if (!tenant || !promptText.trim()) return;
    const userTurn: ChatTurn = {
      id: `${Date.now()}_u`,
      role: 'user',
      text: promptText.trim(),
    };
    setHistory((prev) => [...prev, userTurn]);
    setQuestion('');
    setLoading(true);

    try {
      const res = await apiRequest<{ answer: string; toolsUsed: string[]; mode: string }>('/api/ai/assistant', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: tenant.id,
          boardId: board?.id,
          question: promptText.trim(),
        }),
      });

      setHistory((prev) => [
        ...prev,
        {
          id: `${Date.now()}_a`,
          role: 'assistant',
          text: res.answer,
          toolsUsed: res.toolsUsed,
          mode: res.mode,
        },
      ]);
    } catch (err: any) {
      setHistory((prev) => [
        ...prev,
        {
          id: `${Date.now()}_err`,
          role: 'assistant',
          text: `Error: ${err?.message || 'Unable to reach AI assistant endpoint.'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
      <div className="w-full max-w-md bg-white h-full border-l border-slate-200 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Bot className="w-4 h-4 text-blue-600 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                Agentic Kanban Assistant
              </h3>
              <p className="text-[11px] text-slate-500 truncate">
                Read-only tools scoped strictly to {tenant.name} ({tenant.id})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {history.length === 0 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Ask natural-language questions about tasks, overdue deadlines, or recent activity. The backend verifies your branch membership and executes allowlisted read-only tools (<code className="font-mono">get_tasks</code>, <code className="font-mono">get_overdue_tasks</code>, <code className="font-mono">get_activity_logs</code>, <code className="font-mono">get_board_summary</code>).
              </p>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-800">Try a verified query:</p>
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={loading}
                    onClick={() => askQuestion(p)}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.map((turn) => (
            <div
              key={turn.id}
              className={`rounded-xl p-3.5 text-xs leading-relaxed whitespace-pre-wrap ${
                turn.role === 'user'
                  ? 'bg-blue-600 text-white ml-8'
                  : 'bg-slate-50 border border-slate-200 text-slate-800 mr-4'
              }`}
            >
              <div>{turn.text}</div>
              {turn.toolsUsed && turn.toolsUsed.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-200/80 text-[11px] font-mono text-slate-500">
                  Tools executed: {turn.toolsUsed.join(' · ')}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-500 animate-pulse">
              Running authorized branch tools in {tenant.name}...
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            askQuestion(question);
          }}
          className="p-4 border-t border-slate-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`Ask about ${tenant.name} tasks...`}
            className="flex-1 px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="p-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
