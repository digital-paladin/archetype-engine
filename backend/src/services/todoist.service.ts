import axios, { AxiosInstance } from 'axios';

/** Todoist REST v2 is deprecated (HTTP 410). Use api/v1. */
export const TODOIST_BASE_URL = 'https://api.todoist.com/api/v1';

export interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  parent_id?: string;
  section_id?: string | null;
  priority?: 1 | 2 | 3 | 4;
  due?: {
    string?: string;
    date?: string;
    datetime?: string;
    is_recurring?: boolean;
    lang?: string;
  };
  /** Normalized from api/v1 `checked` for frontend compatibility */
  is_completed?: boolean;
  checked?: boolean;
  labels?: string[];
  /** Normalized from api/v1 `child_order` */
  order?: number;
  child_order?: number;
  url?: string;
}

export interface CreateTaskParams {
  content: string;
  description?: string;
  project_id?: string;
  parent_id?: string;
  section_id?: string;
  priority?: 1 | 2 | 3 | 4;
  due_string?: string;
  due_date?: string;
  labels?: string[];
  order?: number;
}

export interface UpdateTaskParams {
  content?: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4;
  due_string?: string;
  due_date?: string;
  labels?: string[];
}

export interface MoveTaskParams {
  project_id?: string;
  section_id?: string;
  parent_id?: string;
}

export interface TodoistProject {
  id: string;
  name: string;
  color?: string;
  comment_count?: number;
  order?: number;
  child_order?: number;
  is_favorite?: boolean;
  is_inbox_project?: boolean;
  is_team_inbox?: boolean;
  url?: string;
}

export interface CreateProjectParams {
  name: string;
  color?: string;
  is_favorite?: boolean;
}

/** Raw page shape from api/v1 list endpoints */
export interface TodoistPage<T> {
  results?: T[];
  next_cursor?: string | null;
}

/** Unwrap a single page — also tolerates legacy bare-array responses */
export function unwrapPage<T>(data: TodoistPage<T> | T[]): { items: T[]; nextCursor: string | null } {
  if (Array.isArray(data)) {
    return { items: data, nextCursor: null };
  }
  return {
    items: data?.results ?? [],
    nextCursor: data?.next_cursor ?? null,
  };
}

/** Map api/v1 task fields to the shape the Angular panel already expects */
export function normalizeTask(raw: TodoistTask): TodoistTask {
  const checked = raw.checked ?? raw.is_completed ?? false;
  return {
    ...raw,
    is_completed: checked,
    order: raw.order ?? raw.child_order,
  };
}

export function normalizeProject(raw: TodoistProject): TodoistProject {
  return {
    ...raw,
    order: raw.order ?? raw.child_order,
  };
}

export function filterTasksByLabel(tasks: TodoistTask[], label: string): TodoistTask[] {
  return tasks.filter((t) => (t.labels ?? []).includes(label));
}

export class TodoistService {
  private client: AxiosInstance;
  private token: string;

  constructor(token?: string) {
    const resolved = token ?? process.env.TODOIST_API_TOKEN;
    if (!resolved) {
      throw new Error('TODOIST_API_TOKEN not set in environment variables');
    }
    this.token = resolved;
    this.client = axios.create({
      baseURL: TODOIST_BASE_URL,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetch every page for a list path. Query params are re-sent with each cursor.
   */
  private async fetchAllPages<T>(
    path: string,
    params?: Record<string, string | number | undefined>
  ): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | null = null;
    const cleanParams: Record<string, string | number> = {};
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') cleanParams[k] = v;
      }
    }

    do {
      const pageParams: Record<string, string | number> = { ...cleanParams };
      if (cursor) pageParams.cursor = cursor;

      const response = await this.client.get<TodoistPage<T> | T[]>(path, { params: pageParams });
      const unwrapped = unwrapPage<T>(response.data);
      rows.push(...unwrapped.items);
      cursor = unwrapped.nextCursor;
    } while (cursor);

    return rows;
  }

  // ─── Tasks ───────────────────────────────────────────────────────────────────

  async getTasks(params?: {
    project_id?: string;
    label?: string;
    filter?: string;
    ids?: string[];
  }): Promise<TodoistTask[]> {
    // Prefer Todoist's filter engine when a filter string is provided
    if (params?.filter) {
      try {
        const filtered = await this.fetchAllPages<TodoistTask>('/tasks/filter', {
          query: params.filter,
        });
        let tasks = filtered.map(normalizeTask);
        if (params.project_id) {
          tasks = tasks.filter((t) => t.project_id === params.project_id);
        }
        if (params.label) {
          tasks = filterTasksByLabel(tasks, params.label);
        }
        if (params.ids?.length) {
          const idSet = new Set(params.ids);
          tasks = tasks.filter((t) => idSet.has(t.id));
        }
        return tasks;
      } catch {
        // Fall through to /tasks?filter= (works for simple filters like "today")
      }
    }

    const listParams: Record<string, string | undefined> = {
      project_id: params?.project_id,
      filter: params?.filter,
      ids: params?.ids?.join(','),
    };

    let tasks = (await this.fetchAllPages<TodoistTask>('/tasks', listParams)).map(normalizeTask);

    // api/v1 `label` query is unreliable for names with spaces/parens — filter client-side
    if (params?.label) {
      tasks = filterTasksByLabel(tasks, params.label);
    }

    return tasks;
  }

  async getTask(taskId: string): Promise<TodoistTask> {
    const response = await this.client.get<TodoistTask>(`/tasks/${taskId}`);
    return normalizeTask(response.data);
  }

  async createTask(params: CreateTaskParams): Promise<TodoistTask> {
    const response = await this.client.post<TodoistTask>('/tasks', params);
    return normalizeTask(response.data);
  }

  async createTaskWithSubtasks(
    parent: CreateTaskParams,
    subtasks: CreateTaskParams[]
  ): Promise<{ parent: TodoistTask; subtasks: TodoistTask[] }> {
    const parentTask = await this.createTask(parent);
    const createdSubtasks: TodoistTask[] = [];
    for (const subtask of subtasks) {
      createdSubtasks.push(
        await this.createTask({ ...subtask, parent_id: parentTask.id })
      );
      await sleep(120);
    }
    return { parent: parentTask, subtasks: createdSubtasks };
  }

  async updateTask(taskId: string, params: UpdateTaskParams): Promise<TodoistTask> {
    const response = await this.client.post<TodoistTask>(`/tasks/${taskId}`, params);
    return normalizeTask(response.data);
  }

  /**
   * Move a task to a different project, section, or parent.
   * api/v1: project/section/parent changes must use /move — not POST update.
   */
  async moveTask(taskId: string, params: MoveTaskParams): Promise<TodoistTask> {
    const keys = [params.project_id, params.section_id, params.parent_id].filter(Boolean);
    if (keys.length !== 1) {
      throw new Error('moveTask requires exactly one of project_id, section_id, or parent_id');
    }
    await this.client.post(`/tasks/${taskId}/move`, params);
    return this.getTask(taskId);
  }

  async closeTask(taskId: string): Promise<void> {
    await this.client.post(`/tasks/${taskId}/close`);
  }

  async reopenTask(taskId: string): Promise<void> {
    await this.client.post(`/tasks/${taskId}/reopen`);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.client.delete(`/tasks/${taskId}`);
  }

  // ─── Projects ─────────────────────────────────────────────────────────────────

  async getProjects(): Promise<TodoistProject[]> {
    const projects = await this.fetchAllPages<TodoistProject>('/projects');
    return projects.map(normalizeProject);
  }

  async getProject(projectId: string): Promise<TodoistProject> {
    const response = await this.client.get<TodoistProject>(`/projects/${projectId}`);
    return normalizeProject(response.data);
  }

  async createProject(params: CreateProjectParams): Promise<TodoistProject> {
    const response = await this.client.post<TodoistProject>('/projects', params);
    return normalizeProject(response.data);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`/projects/${projectId}`);
  }

  // ─── Bulk scaffolding helpers ─────────────────────────────────────────────────

  async scaffoldProject(
    projectName: string,
    tasks: Array<{ task: CreateTaskParams; subtasks?: CreateTaskParams[] }>
  ): Promise<{
    project: TodoistProject;
    tasks: Array<{ parent: TodoistTask; subtasks: TodoistTask[] }>;
  }> {
    const project = await this.createProject({ name: projectName });
    const createdTasks: Array<{ parent: TodoistTask; subtasks: TodoistTask[] }> = [];
    for (const { task, subtasks = [] } of tasks) {
      createdTasks.push(
        await this.createTaskWithSubtasks(
          { ...task, project_id: project.id },
          subtasks.map((s) => ({ ...s, project_id: project.id }))
        )
      );
      await sleep(120);
    }
    return { project, tasks: createdTasks };
  }

  // ─── Quest Pointers ─────────────────────────────────────────────────────────

  static readonly LABEL_CURRENT = 'CurrentQuest (ptr.current)';
  static readonly LABEL_NEXT = 'NextImmediateQuest (ptr.next)';
  static readonly PRIORITY_CURRENT: 4 = 4; // P1 🔴
  static readonly PRIORITY_NEXT: 3 = 3; // P2 🟠

  async getQuestPointers(): Promise<{ current: TodoistTask | null; next: TodoistTask | null }> {
    const all = await this.getTasks();
    const current = filterTasksByLabel(all, TodoistService.LABEL_CURRENT)[0] ?? null;
    const next = filterTasksByLabel(all, TodoistService.LABEL_NEXT)[0] ?? null;
    return { current, next };
  }

  async setQuestPointer(slot: 'current' | 'next', taskId: string): Promise<TodoistTask> {
    const label = slot === 'current' ? TodoistService.LABEL_CURRENT : TodoistService.LABEL_NEXT;
    const priority =
      slot === 'current' ? TodoistService.PRIORITY_CURRENT : TodoistService.PRIORITY_NEXT;

    const existing = await this.getTasks({ label }).catch(() => [] as TodoistTask[]);
    const oldHolder = existing[0] ?? null;

    if (oldHolder && oldHolder.id !== taskId) {
      const cleanedLabels = (oldHolder.labels ?? []).filter((l) => l !== label);
      await this.updateTask(oldHolder.id, { labels: cleanedLabels });
    }

    const target = await this.getTask(taskId);
    const newLabels = Array.from(new Set([...(target.labels ?? []), label]));
    return this.updateTask(taskId, { labels: newLabels, priority });
  }

  async clearQuestPointer(slot: 'current' | 'next'): Promise<void> {
    const label = slot === 'current' ? TodoistService.LABEL_CURRENT : TodoistService.LABEL_NEXT;
    const existing = await this.getTasks({ label }).catch(() => [] as TodoistTask[]);
    if (!existing[0]) return;
    const cleanedLabels = (existing[0].labels ?? []).filter((l) => l !== label);
    await this.updateTask(existing[0].id, { labels: cleanedLabels });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _instance: TodoistService | null = null;

export function getTodoistService(): TodoistService {
  if (!_instance) {
    _instance = new TodoistService();
  }
  return _instance;
}

export function resetTodoistServiceForTests(): void {
  _instance = null;
}
