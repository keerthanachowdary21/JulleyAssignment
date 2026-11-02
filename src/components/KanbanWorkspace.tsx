import React, { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Search, Trash2 } from 'lucide-react';
import type { Board, BoardColumn, PriorityType, RoleType, Task } from '../types.ts';

interface KanbanWorkspaceProps {
  board: Board | null;
  columns: BoardColumn[];
  tasks: Task[];
  role: RoleType;
  loading: boolean;
  onSelectTask: (task: Task) => void;
  onOpenNewTaskModal: (defaultColumnId?: string) => void;
  onMoveTask: (taskId: string, destinationColumnId: string, newPosition: number, expectedVersion: number) => Promise<void>;
  onCreateColumn: (name: string) => Promise<void>;
  onDeleteColumn: (columnId: string) => Promise<void>;
}

const PRIORITY_TEXT_COLOR: Record<PriorityType, string> = {
  URGENT: 'text-red-700 font-semibold',
  HIGH: 'text-amber-700 font-semibold',
  MEDIUM: 'text-slate-700 font-medium',
  LOW: 'text-slate-500 font-normal',
};

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  if ((task.column_name || '').toLowerCase() === 'done') return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.due_date < today;
}

interface SortableTaskCardProps {
  task: Task;
  onClick: () => void;
}

const SortableTaskCard: React.FC<SortableTaskCardProps> = ({ task, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: {
      type: 'Task',
      task,
    },
  });

  const overdue = isOverdue(task);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`group bg-white border rounded-lg p-3.5 transition-colors select-none ${
        isDragging
          ? 'opacity-40 border-blue-400 bg-blue-50/30'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onClick}
          className="text-left flex-1 min-w-0 focus-visible:outline-2 focus-visible:outline-blue-600 rounded-xs cursor-pointer"
        >
          <h4 className="text-sm font-semibold text-slate-900 leading-snug group-hover:text-blue-700 transition-colors">
            {task.title}
          </h4>
        </button>

        <button
          type="button"
          aria-label={`Drag ${task.title}`}
          {...attributes}
          {...listeners}
          className="p-1 -mr-1 -mt-0.5 text-slate-400 hover:text-slate-700 rounded cursor-grab active:cursor-grabbing shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </div>

      {task.description && (
        <p
          onClick={onClick}
          className="text-xs text-slate-600 mt-1.5 line-clamp-2 leading-relaxed cursor-pointer"
        >
          {task.description}
        </p>
      )}

      {/* Zero-Pill Metadata Discipline: Clean unboxed inline text separated by · */}
      <div
        onClick={onClick}
        className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500 cursor-pointer"
      >
        <span className={PRIORITY_TEXT_COLOR[task.priority]}>{task.priority}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate max-w-[115px] text-slate-700">
          {task.assignee_name || 'Unassigned'}
        </span>
        {task.due_date && (
          <>
            <span aria-hidden="true">·</span>
            <span className={`font-mono tabular-nums ${overdue ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
              {overdue ? `Overdue ${task.due_date.slice(5)}` : `Due ${task.due_date.slice(5)}`}
            </span>
          </>
        )}
        <span className="ml-auto font-mono text-[11px] text-slate-400 tabular-nums">
          v{task.version}
        </span>
      </div>

      {task.labels && task.labels.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
          {task.labels.map((lbl, idx) => (
            <React.Fragment key={lbl}>
              {idx > 0 && <span aria-hidden="true">/</span>}
              <span>{lbl}</span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

interface DroppableColumnProps {
  column: BoardColumn;
  tasks: Task[];
  canManageColumns: boolean;
  onSelectTask: (task: Task) => void;
  onAddTask: () => void;
  onDeleteColumn: () => void;
}

const DroppableColumn: React.FC<DroppableColumnProps> = ({
  column,
  tasks,
  canManageColumns,
  onSelectTask,
  onAddTask,
  onDeleteColumn,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: 'Column',
      column,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`w-[300px] lg:w-[312px] shrink-0 flex flex-col rounded-xl border transition-colors ${
        isOver ? 'bg-blue-50/60 border-blue-300' : 'bg-slate-100/80 border-slate-200/90'
      }`}
    >
      {/* Column Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-slate-200/80">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-bold text-slate-800 truncate">{column.name}</h3>
          <span className="text-xs font-mono text-slate-500 tabular-nums">{tasks.length}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onAddTask}
            title={`Add task to ${column.name}`}
            className="p-1 text-slate-500 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          {canManageColumns && tasks.length === 0 && (
            <button
              type="button"
              onClick={onDeleteColumn}
              title={`Delete empty column ${column.name}`}
              className="p-1 text-slate-400 hover:text-red-600 hover:bg-white rounded transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Column Tasks */}
      <div className="p-3 flex-1 flex flex-col gap-2.5 min-h-[260px]">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onClick={() => onSelectTask(task)}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 text-center border border-dashed border-slate-300/80 rounded-lg">
            <p className="text-xs text-slate-500">No tasks in {column.name}</p>
            <button
              type="button"
              onClick={onAddTask}
              className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer whitespace-nowrap"
            >
              + Add Task
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export function KanbanWorkspace({
  board,
  columns,
  tasks,
  role,
  loading,
  onSelectTask,
  onOpenNewTaskModal,
  onMoveTask,
  onCreateColumn,
  onDeleteColumn,
}: KanbanWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'URGENT' | 'HIGH' | 'OVERDUE'>('ALL');
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');

  const canManageColumns = role === 'ORG_ADMIN' || role === 'TENANT_ADMIN';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          (t.assignee_name || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (filterMode === 'URGENT') return t.priority === 'URGENT';
      if (filterMode === 'HIGH') return t.priority === 'HIGH' || t.priority === 'URGENT';
      if (filterMode === 'OVERDUE') return isOverdue(t);
      return true;
    });
  }, [tasks, searchQuery, filterMode]);

  function handleDragStart(event: DragStartEvent) {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) {
      setActiveDragTask(task);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragTask(null);
    if (!over) return;

    const draggedTask = tasks.find((t) => t.id === active.id);
    if (!draggedTask) return;

    const overId = String(over.id);

    let destinationColumnId = draggedTask.column_id;
    let newPosition = draggedTask.position;

    // Dropped directly onto a column container
    const overColumn = columns.find((c) => c.id === overId);
    if (overColumn) {
      destinationColumnId = overColumn.id;
      const destTasks = tasks
        .filter((t) => t.column_id === destinationColumnId && t.id !== draggedTask.id)
        .sort((a, b) => a.position - b.position);
      newPosition = destTasks.length + 1;
    } else {
      // Dropped onto another task card
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      destinationColumnId = overTask.column_id;
      const destTasks = tasks
        .filter((t) => t.column_id === destinationColumnId)
        .sort((a, b) => a.position - b.position);
      const overIndex = destTasks.findIndex((t) => t.id === overTask.id);
      newPosition = overIndex >= 0 ? overIndex + 1 : 1;
    }

    if (destinationColumnId === draggedTask.column_id && newPosition === draggedTask.position) {
      return;
    }

    await onMoveTask(draggedTask.id, destinationColumnId, newPosition, draggedTask.version);
  }

  async function handleAddColumnSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newColumnName.trim()) return;
    await onCreateColumn(newColumnName.trim());
    setNewColumnName('');
    setAddingColumn(false);
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-10 w-80 bg-slate-200/70 rounded-lg animate-pulse" />
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="w-[300px] h-[420px] bg-slate-200/60 rounded-xl animate-pulse shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="p-12 text-center max-w-md mx-auto space-y-3">
        <h2 className="text-lg font-bold text-slate-900">No board selected in this branch</h2>
        <p className="text-sm text-slate-600">
          Select an existing project board in the sidebar or create a new board to begin managing tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Workspace Filter & Search Toolbar */}
      <div className="px-6 py-3.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-slate-600 truncate max-w-xl">
            {board.description || 'Drag task cards across columns to synchronize status in real time.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks or assignee..."
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white w-48 sm:w-56"
            />
          </div>

          {/* Interactive Segmented Filter Controls */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'URGENT', 'HIGH', 'OVERDUE'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterMode(f)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterMode === f
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f === 'ALL' ? 'All Tasks' : f === 'URGENT' ? 'Urgent' : f === 'HIGH' ? 'High+' : 'Overdue'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Horizontal Kanban Columns Canvas */}
      <div className="flex-1 overflow-x-auto p-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex items-start gap-4 min-h-full">
            {columns.map((col) => {
              const colTasks = filteredTasks
                .filter((t) => t.column_id === col.id)
                .sort((a, b) => a.position - b.position);

              return (
                <DroppableColumn
                  key={col.id}
                  column={col}
                  tasks={colTasks}
                  canManageColumns={canManageColumns}
                  onSelectTask={onSelectTask}
                  onAddTask={() => onOpenNewTaskModal(col.id)}
                  onDeleteColumn={() => onDeleteColumn(col.id)}
                />
              );
            })}

            {canManageColumns && (
              <div className="w-[280px] shrink-0">
                {addingColumn ? (
                  <form
                    onSubmit={handleAddColumnSubmit}
                    className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3"
                  >
                    <label className="block text-xs font-semibold text-slate-700">
                      New Status Column
                    </label>
                    <input
                      type="text"
                      autoFocus
                      required
                      value={newColumnName}
                      onChange={(e) => setNewColumnName(e.target.value)}
                      placeholder="e.g. Code Review"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        Save Column
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingColumn(false)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingColumn(true)}
                    className="w-full py-3 px-4 border border-dashed border-slate-300 hover:border-slate-400 bg-white/60 hover:bg-white rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Workflow Column</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <DragOverlay>
            {activeDragTask ? (
              <div className="w-[300px] bg-white border-2 border-blue-600 rounded-lg p-3.5 shadow-lg opacity-95 rotate-1">
                <h4 className="text-sm font-semibold text-slate-900">{activeDragTask.title}</h4>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={PRIORITY_TEXT_COLOR[activeDragTask.priority]}>
                    {activeDragTask.priority}
                  </span>
                  <span>·</span>
                  <span>{activeDragTask.assignee_name || 'Unassigned'}</span>
                  <span className="ml-auto font-mono">v{activeDragTask.version}</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
