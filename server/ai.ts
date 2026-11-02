import { GoogleGenAI, Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { db } from './db.ts';

function executeGetTasks(tenantId: string, boardId?: string, statusFilter?: string) {
  let sql = `
    SELECT t.id, t.title, t.priority, t.due_date, t.version,
           c.name as column_name, b.name as board_name, u.name as assignee_name
    FROM tasks t
    JOIN columns c ON c.id = t.column_id
    JOIN boards b ON b.id = t.board_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.tenant_id = ?
  `;
  const params: unknown[] = [tenantId];
  if (boardId) {
    sql += ' AND t.board_id = ?';
    params.push(boardId);
  }
  if (statusFilter) {
    sql += ' AND LOWER(c.name) = LOWER(?)';
    params.push(statusFilter);
  }
  sql += ' ORDER BY c.position ASC, t.position ASC';
  return db.prepare(sql).all(...params);
}

function executeGetOverdueTasks(tenantId: string, boardId?: string) {
  const today = new Date().toISOString().slice(0, 10);
  let sql = `
    SELECT t.id, t.title, t.priority, t.due_date,
           c.name as column_name, b.name as board_name, u.name as assignee_name
    FROM tasks t
    JOIN columns c ON c.id = t.column_id
    JOIN boards b ON b.id = t.board_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.tenant_id = ?
      AND t.due_date IS NOT NULL
      AND t.due_date < ?
      AND LOWER(c.name) != 'done'
  `;
  const params: unknown[] = [tenantId, today];
  if (boardId) {
    sql += ' AND t.board_id = ?';
    params.push(boardId);
  }
  sql += ' ORDER BY t.due_date ASC';
  return db.prepare(sql).all(...params);
}

function executeGetActivityLogs(tenantId: string, limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  return db
    .prepare(
      `SELECT a.action, a.entity_type, a.details, a.created_at, u.name as user_name
       FROM activity_logs a
       JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = ?
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .all(tenantId, safeLimit);
}

function executeGetBoardSummary(tenantId: string, boardId?: string) {
  let sql = `
    SELECT c.name as column_name, COUNT(t.id) as task_count
    FROM columns c
    JOIN boards b ON b.id = c.board_id
    LEFT JOIN tasks t ON t.column_id = c.id AND t.tenant_id = ?
    WHERE c.tenant_id = ?
  `;
  const params: unknown[] = [tenantId, tenantId];
  if (boardId) {
    sql += ' AND c.board_id = ?';
    params.push(boardId);
  }
  sql += ' GROUP BY c.name ORDER BY MIN(c.position) ASC';
  const breakdown = db.prepare(sql).all(...params) as Array<{ column_name: string; task_count: number }>;

  let total = 0;
  let done = 0;
  for (const row of breakdown) {
    total += row.task_count;
    if (row.column_name.toLowerCase() === 'done') {
      done += row.task_count;
    }
  }
  const overdue = executeGetOverdueTasks(tenantId, boardId).length;
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    totalTasks: total,
    completedTasks: done,
    overdueTasks: overdue,
    completionRatePercent: completionRate,
    byColumn: breakdown,
  };
}

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'get_tasks',
    description: 'Retrieve tasks belonging strictly to the authenticated tenant workspace, optionally filtered by status column.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        statusFilter: {
          type: Type.STRING,
          description: 'Optional column name filter such as "To Do", "In Progress", "Testing", or "Done".',
        },
      },
    },
  },
  {
    name: 'get_overdue_tasks',
    description: 'Retrieve incomplete tasks whose due date has already passed inside the authorized tenant workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includeBoardFilter: {
          type: Type.BOOLEAN,
          description: 'Whether to scope strictly to the currently active board.',
        },
      },
    },
  },
  {
    name: 'get_activity_logs',
    description: 'Retrieve recent audit and collaboration activity logs in the authorized tenant workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of recent activity records to fetch (1 to 25).',
        },
      },
    },
  },
  {
    name: 'get_board_summary',
    description: 'Calculate task counts per column, completion rate percentage, and overdue count for the authorized tenant.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scopeToCurrentBoard: {
          type: Type.BOOLEAN,
          description: 'True to summarize only the selected board, false to summarize the entire branch tenant.',
        },
      },
    },
  },
];

export async function runTenantKanbanAgent(params: {
  question: string;
  tenantId: string;
  tenantName: string;
  boardId?: string;
  userName: string;
}): Promise<{ answer: string; toolsUsed: string[]; mode: 'gemini-agent' | 'local-tool-fallback' }> {
  const { question, tenantId, tenantName, boardId, userName } = params;
  const toolsUsed: string[] = [];

  const apiKey = process.env.GEMINI_API_KEY;
  const hasRealKey = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 10);

  if (hasRealKey) {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction =
      `You are the read-only Agentic AI Kanban Assistant for the "${tenantName}" branch workspace. ` +
      `You are assisting authenticated user "${userName}". ` +
      `You ONLY have access to data inside tenant "${tenantName}" (${tenantId}) via your allowlisted tools. ` +
      `Always call the relevant tool(s) first to ground your answer in real database counts, task titles, assignees, and due dates. ` +
      `Format your answer concisely with clear bullet points and exact counts.`;

    const contents: any[] = [{ role: 'user', parts: [{ text: question }] }];

    let response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: toolDeclarations }],
      },
    });

    // Execute up to 2 rounds of function calls
    for (let step = 0; step < 2; step++) {
      const candidateContent = response.candidates?.[0]?.content;
      const calls = response.functionCalls;
      if (!candidateContent || !calls || calls.length === 0) {
        break;
      }

      contents.push(candidateContent);
      const responseParts: any[] = [];

      for (const call of calls) {
        const name = call.name || '';
        toolsUsed.push(name);
        let result: unknown = {};
        const args = (call.args || {}) as Record<string, any>;

        if (name === 'get_tasks') {
          result = executeGetTasks(tenantId, boardId, args.statusFilter);
        } else if (name === 'get_overdue_tasks') {
          result = executeGetOverdueTasks(tenantId, args.includeBoardFilter ? boardId : undefined);
        } else if (name === 'get_activity_logs') {
          result = executeGetActivityLogs(tenantId, args.limit ?? 10);
        } else if (name === 'get_board_summary') {
          result = executeGetBoardSummary(tenantId, args.scopeToCurrentBoard ? boardId : undefined);
        }

        responseParts.push({
          functionResponse: {
            id: call.id,
            name,
            response: { result },
          },
        });
      }

      contents.push({ role: 'user', parts: responseParts });

      response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: toolDeclarations }],
        },
      });
    }

    return {
      answer: response.text || 'Completed analysis of authorized workspace records.',
      toolsUsed: Array.from(new Set(toolsUsed)),
      mode: 'gemini-agent',
    };
  }

  // Deterministic read-only tool execution fallback when GEMINI_API_KEY is not set in local dev
  const q = question.toLowerCase();
  const summary = executeGetBoardSummary(tenantId, boardId);
  toolsUsed.push('get_board_summary');

  if (q.includes('overdue') || q.includes('late') || q.includes('urgent')) {
    const overdue = executeGetOverdueTasks(tenantId, boardId) as any[];
    toolsUsed.push('get_overdue_tasks');
    const lines = overdue.map(
      (t) => `- ${t.title} (${t.priority} · Due ${t.due_date} · Assigned: ${t.assignee_name || 'Unassigned'})`
    );
    return {
      answer:
        `Authorized Branch Summary for ${tenantName}:\n` +
        `- Overdue incomplete tasks: ${overdue.length}\n` +
        (lines.length > 0 ? lines.join('\n') : '- All active tasks are within their target due dates.'),
      toolsUsed,
      mode: 'local-tool-fallback',
    };
  }

  if (q.includes('activity') || q.includes('recent') || q.includes('history') || q.includes('today')) {
    const logs = executeGetActivityLogs(tenantId, 6) as any[];
    toolsUsed.push('get_activity_logs');
    const lines = logs.map((l) => `- ${l.user_name} ${l.action.toLowerCase()} ${l.entity_type} (${l.created_at.slice(0, 16).replace('T', ' ')})`);
    return {
      answer:
        `Recent Activity in ${tenantName} (${logs.length} latest records):\n` +
        (lines.length > 0 ? lines.join('\n') : '- No recent activity recorded yet.'),
      toolsUsed,
      mode: 'local-tool-fallback',
    };
  }

  const tasks = executeGetTasks(tenantId, boardId) as any[];
  toolsUsed.push('get_tasks');
  const breakdownStr = summary.byColumn.map((c) => `${c.column_name}: ${c.task_count}`).join(' · ');

  return {
    answer:
      `Workspace Insights for ${tenantName}:\n` +
      `- Total Tasks: ${summary.totalTasks} (${breakdownStr})\n` +
      `- Completion Rate: ${summary.completionRatePercent}%\n` +
      `- Overdue Tasks: ${summary.overdueTasks}\n` +
      `- Active Priorities: ${tasks.filter((t) => t.priority === 'URGENT' || t.priority === 'HIGH').length} High/Urgent items.`,
    toolsUsed,
    mode: 'local-tool-fallback',
  };
}
