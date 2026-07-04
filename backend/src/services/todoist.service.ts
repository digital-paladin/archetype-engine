import axios, { AxiosInstance } from 'axios';

const TODOIST_BASE_URL = 'https://api.todoist.com/rest/v2';

export interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  parent_id?: string;
  priority?: 1 | 2 | 3 | 4;
  due?: {
    string?: string;
    date?: string;
    datetime?: string;
  };
  is_completed?: boolean;
  labels?: string[];
  order?: number;
  url?: string;
}

export interface CreateTaskParams {
  content: string;
  description?: string;
  project_id?: string;
  parent_id?: string;
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

export interface TodoistProject {
  id: string;
  name: string;
  color?: string;
  comment_count?: number;
  order?: number;
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

export class TodoistService {
  private client: AxiosInstance;
  private token: string;

  constructor() {
    const token = process.env.TODOIST_API_TOKEN;
    if (!token) {
      throw new Error('TODOIST_API_TOKEN not set in environment variables');
    }
    this.token = token;
    this.client = axios.create({
      baseURL: TODOIST_BASE_URL,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ─── Tasks ───────────────────────────────────────────────────────────────────

  async getTasks(params?: {
    project_id?: string;
    label?: string;
    filter?: string;
    ids?: string[];
  }): Promise<TodoistTask[]> {
    const response = await this.client.get<TodoistTask[]>('/tasks', { params });
    return response.data;
  }

  async getTask(taskId: string): Promise<TodoistTask> {
    const response = await this.client.get<TodoistTask>(`/tasks/${taskId}`);
    return response.data;
  }

  async createTask(params: CreateTaskParams): Promise<TodoistTask> {
    const response = await this.client.post<TodoistTask>('/tasks', params);
    return response.data;
  }

  async createTaskWithSubtasks(
    parent: CreateTaskParams,
    subtasks: CreateTaskParams[]
  ): Promise<{ parent: TodoistTask; subtasks: TodoistTask[] }> {
    const parentTask = await this.createTask(parent);
    const createdSubtasks = await Promise.all(
      subtasks.map((subtask) =>
        this.createTask({ ...subtask, parent_id: parentTask.id })
      )
    );
    return { parent: parentTask, subtasks: createdSubtasks };
  }

  async updateTask(taskId: string, params: UpdateTaskParams): Promise<TodoistTask> {
    const response = await this.client.post<TodoistTask>(`/tasks/${taskId}`, params);
    return response.data;
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
    const response = await this.client.get<TodoistProject[]>('/projects');
    return response.data;
  }

  async getProject(projectId: string): Promise<TodoistProject> {
    const response = await this.client.get<TodoistProject>(`/projects/${projectId}`);
    return response.data;
  }

  async createProject(params: CreateProjectParams): Promise<TodoistProject> {
    const response = await this.client.post<TodoistProject>('/projects', params);
    return response.data;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`/projects/${projectId}`);
  }

  // ─── Bulk scaffolding helpers ─────────────────────────────────────────────────

  /**
   * Scaffold an entire project with a parent task tree.
   * Useful for AI agent: "Create Rwanda Phase 0 checklist" → creates project + all tasks in one call.
   *
   * @param projectName - Name of the Todoist project to create
   * @param tasks - Array of { task, subtasks[] } definitions
   * @returns Created project + full task tree
   */
  async scaffoldProject(
    projectName: string,
    tasks: Array<{ task: CreateTaskParams; subtasks?: CreateTaskParams[] }>
  ): Promise<{
    project: TodoistProject;
    tasks: Array<{ parent: TodoistTask; subtasks: TodoistTask[] }>;
  }> {
    const project = await this.createProject({ name: projectName });
    const createdTasks = await Promise.all(
      tasks.map(({ task, subtasks = [] }) =>
        this.createTaskWithSubtasks(
          { ...task, project_id: project.id },
          subtasks.map((s) => ({ ...s, project_id: project.id }))
        )
      )
    );
    return { project, tasks: createdTasks };
  }

  // ─── Quest Pointers ─────────────────────────────────────────────────────────

  /**
   * Canonical label names for the two quest pointer slots.
   * Must match the labels created in Todoist exactly.
   */
  static readonly LABEL_CURRENT = 'CurrentQuest (ptr.current)';
  static readonly LABEL_NEXT = 'NextImmediateQuest (ptr.next)';
  static readonly PRIORITY_CURRENT: 4 = 4; // P1 🔴
  static readonly PRIORITY_NEXT: 3 = 3;    // P2 🟠

  /**
   * Return the task currently tagged with ptr.current and ptr.next.
   * Either slot may be null if no task holds that label.
   */
  async getQuestPointers(): Promise<{ current: TodoistTask | null; next: TodoistTask | null }> {
    const [currentTasks, nextTasks] = await Promise.all([
      this.getTasks({ label: TodoistService.LABEL_CURRENT }).catch(() => [] as TodoistTask[]),
      this.getTasks({ label: TodoistService.LABEL_NEXT }).catch(() => [] as TodoistTask[]),
    ]);
    return {
      current: currentTasks[0] ?? null,
      next: nextTasks[0] ?? null,
    };
  }

  /**
   * Atomically move the quest pointer for a given slot to a new task.
   *
   * Steps:
   *   1. Find any task currently holding the label (old holder)
   *   2. Remove the label + reset priority on old holder (if different from new task)
   *   3. Add the label + set correct priority on the new task
   *
   * @param slot    'current' or 'next'
   * @param taskId  Todoist task ID to promote
   * @returns       The updated task
   */
  async setQuestPointer(slot: 'current' | 'next', taskId: string): Promise<TodoistTask> {
    const label = slot === 'current' ? TodoistService.LABEL_CURRENT : TodoistService.LABEL_NEXT;
    const priority = slot === 'current' ? TodoistService.PRIORITY_CURRENT : TodoistService.PRIORITY_NEXT;

    // 1. Find existing holder of this label
    const existing = await this.getTasks({ label }).catch(() => [] as TodoistTask[]);
    const oldHolder = existing[0] ?? null;

    // 2. Remove label from old holder (skip if same task — idempotent)
    if (oldHolder && oldHolder.id !== taskId) {
      const cleanedLabels = (oldHolder.labels ?? []).filter((l) => l !== label);
      await this.updateTask(oldHolder.id, { labels: cleanedLabels });
    }

    // 3. Fetch the target task to get its current labels
    const target = await this.getTask(taskId);
    const newLabels = Array.from(new Set([...(target.labels ?? []), label]));
    const updated = await this.updateTask(taskId, { labels: newLabels, priority });

    return updated;
  }

  /**
   * Clear a quest pointer slot (remove label + priority reset).
   * Used when auto-advancing after a quest is closed.
   */
  async clearQuestPointer(slot: 'current' | 'next'): Promise<void> {
    const label = slot === 'current' ? TodoistService.LABEL_CURRENT : TodoistService.LABEL_NEXT;
    const existing = await this.getTasks({ label }).catch(() => [] as TodoistTask[]);
    if (!existing[0]) return;
    const cleanedLabels = (existing[0].labels ?? []).filter((l) => l !== label);
    await this.updateTask(existing[0].id, { labels: cleanedLabels });
  }
}

// Singleton — reuse one instance per server process
let _instance: TodoistService | null = null;

export function getTodoistService(): TodoistService {
  if (!_instance) {
    _instance = new TodoistService();
  }
  return _instance;
}
