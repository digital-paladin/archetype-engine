import { Router, Request, Response } from 'express';
import { getTodoistService, CreateTaskParams, CreateProjectParams } from '../services/todoist.service';

const router = Router();

// ─── Tasks ────────────────────────────────────────────────────────────────────

/**
 * GET /api/todoist/tasks
 * List tasks, optionally filtered by project_id, label, or filter string
 *
 * Query params:
 *   ?project_id=xxx
 *   ?label=xxx
 *   ?filter=xxx  (Todoist filter syntax, e.g. "today", "p1", "overdue")
 */
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const { project_id, label, filter } = req.query as Record<string, string>;
    const todoist = getTodoistService();
    const tasks = await todoist.getTasks({ project_id, label, filter });
    res.json({ success: true, tasks });
  } catch (err: any) {
    console.error('[TODOIST] GET /tasks error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/todoist/tasks/:id
 * Get a single task by ID
 */
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const todoist = getTodoistService();
    const task = await todoist.getTask(req.params.id);
    res.json({ success: true, task });
  } catch (err: any) {
    console.error('[TODOIST] GET /tasks/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/todoist/tasks
 * Create a single task
 *
 * Body: CreateTaskParams
 *   { content, description?, project_id?, parent_id?, priority?, due_string?, labels? }
 */
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const params: CreateTaskParams = req.body;
    if (!params.content) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    const todoist = getTodoistService();
    const task = await todoist.createTask(params);
    console.log(`[TODOIST] Created task: "${task.content}" (id=${task.id})`);
    res.status(201).json({ success: true, task });
  } catch (err: any) {
    console.error('[TODOIST] POST /tasks error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/todoist/tasks/with-subtasks
 * Create a parent task with subtasks in one call
 *
 * Body:
 *   {
 *     task: CreateTaskParams,       // parent task
 *     subtasks: CreateTaskParams[]  // child tasks (parent_id set automatically)
 *   }
 */
router.post('/tasks/with-subtasks', async (req: Request, res: Response) => {
  try {
    const { task, subtasks } = req.body;
    if (!task?.content) {
      return res.status(400).json({ success: false, error: 'task.content is required' });
    }
    if (!Array.isArray(subtasks) || subtasks.length === 0) {
      return res.status(400).json({ success: false, error: 'subtasks must be a non-empty array' });
    }
    const todoist = getTodoistService();
    const result = await todoist.createTaskWithSubtasks(task, subtasks);
    console.log(`[TODOIST] Created task+subtasks: "${result.parent.content}" with ${result.subtasks.length} subtask(s)`);
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    console.error('[TODOIST] POST /tasks/with-subtasks error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/todoist/tasks/:id
 * Update a task (content, description, priority, due_string, labels)
 */
router.patch('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const todoist = getTodoistService();
    const task = await todoist.updateTask(req.params.id, req.body);
    console.log(`[TODOIST] Updated task: "${task.content}" (id=${task.id})`);
    res.json({ success: true, task });
  } catch (err: any) {
    console.error('[TODOIST] PATCH /tasks/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/todoist/tasks/:id/close
 * Mark a task complete
 */
router.post('/tasks/:id/close', async (req: Request, res: Response) => {
  try {
    const todoist = getTodoistService();
    await todoist.closeTask(req.params.id);
    console.log(`[TODOIST] Closed task id=${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[TODOIST] POST /tasks/:id/close error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/todoist/tasks/:id/reopen
 * Reopen a completed task
 */
router.post('/tasks/:id/reopen', async (req: Request, res: Response) => {
  try {
    const todoist = getTodoistService();
    await todoist.reopenTask(req.params.id);
    console.log(`[TODOIST] Reopened task id=${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[TODOIST] POST /tasks/:id/reopen error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/todoist/tasks/:id
 * Delete a task permanently
 */
router.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const todoist = getTodoistService();
    await todoist.deleteTask(req.params.id);
    console.log(`[TODOIST] Deleted task id=${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[TODOIST] DELETE /tasks/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * GET /api/todoist/projects
 * List all projects
 */
router.get('/projects', async (req: Request, res: Response) => {
  try {
    const todoist = getTodoistService();
    const projects = await getTodoistService().getProjects();
    res.json({ success: true, projects });
  } catch (err: any) {
    console.error('[TODOIST] GET /projects error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/todoist/projects
 * Create a new project
 *
 * Body: { name, color?, is_favorite? }
 */
router.post('/projects', async (req: Request, res: Response) => {
  try {
    const params: CreateProjectParams = req.body;
    if (!params.name) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    const todoist = getTodoistService();
    const project = await todoist.createProject(params);
    console.log(`[TODOIST] Created project: "${project.name}" (id=${project.id})`);
    res.status(201).json({ success: true, project });
  } catch (err: any) {
    console.error('[TODOIST] POST /projects error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/todoist/projects/:id
 * Delete a project and all its tasks
 */
router.delete('/projects/:id', async (req: Request, res: Response) => {
  try {
    const todoist = getTodoistService();
    await todoist.deleteProject(req.params.id);
    console.log(`[TODOIST] Deleted project id=${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[TODOIST] DELETE /projects/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Quest Pointers ─────────────────────────────────────────────────────────

/**
 * GET /api/todoist/quest-pointers
 * Return the task currently tagged as ptr.current and ptr.next.
 * Either slot may be null if no task holds the label.
 *
 * Response:
 *   { success: true, current: TodoistTask | null, next: TodoistTask | null }
 */
router.get('/quest-pointers', async (_req: Request, res: Response) => {
  try {
    const todoist = getTodoistService();
    const pointers = await todoist.getQuestPointers();
    res.json({ success: true, ...pointers });
  } catch (err: any) {
    console.error('[TODOIST] GET /quest-pointers error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/todoist/quest-pointer
 * Atomically move ptr.current or ptr.next to a different task.
 *
 * Body:
 *   { slot: 'current' | 'next', taskId: string }
 *
 * What this does:
 *   1. Removes the label from the task currently holding it (if different)
 *   2. Adds the label + sets the correct Todoist priority on the target task
 *      (ptr.current → P1, ptr.next → P2)
 *
 * Response:
 *   { success: true, task: TodoistTask }  — the newly promoted task
 */
router.post('/quest-pointer', async (req: Request, res: Response) => {
  try {
    const { slot, taskId } = req.body as { slot: 'current' | 'next'; taskId: string };

    if (slot !== 'current' && slot !== 'next') {
      return res.status(400).json({ success: false, error: 'slot must be "current" or "next"' });
    }
    if (!taskId || typeof taskId !== 'string') {
      return res.status(400).json({ success: false, error: 'taskId is required' });
    }

    const todoist = getTodoistService();
    const task = await todoist.setQuestPointer(slot, taskId);
    console.log(`[TODOIST] Quest pointer "${slot}" → task "${task.content}" (id=${task.id})`);
    res.json({ success: true, task });
  } catch (err: any) {
    console.error('[TODOIST] POST /quest-pointer error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/todoist/quest-pointer/:slot
 * Clear a quest pointer slot without closing the task.
 * Useful when a quest is abandoned or re-prioritised.
 *
 * Params: slot = 'current' | 'next'
 */
router.delete('/quest-pointer/:slot', async (req: Request, res: Response) => {
  try {
    const slot = req.params.slot as 'current' | 'next';
    if (slot !== 'current' && slot !== 'next') {
      return res.status(400).json({ success: false, error: 'slot must be "current" or "next"' });
    }
    const todoist = getTodoistService();
    await todoist.clearQuestPointer(slot);
    console.log(`[TODOIST] Cleared quest pointer slot "${slot}"`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[TODOIST] DELETE /quest-pointer/:slot error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Scaffolding ──────────────────────────────────────────────────────────────

/**
 * POST /api/todoist/scaffold
 * Create a full project with a task tree in one call.
 * Designed for AI agent use: "Create Rwanda Phase 0 checklist"
 *
 * Body:
 *   {
 *     projectName: string,
 *     tasks: Array<{
 *       task: CreateTaskParams,
 *       subtasks?: CreateTaskParams[]
 *     }>
 *   }
 *
 * Example:
 *   {
 *     "projectName": "Rwanda Phase 0",
 *     "tasks": [
 *       {
 *         "task": { "content": "Documentation", "priority": 2 },
 *         "subtasks": [
 *           { "content": "Gather parents' Rwandan birth certificates" },
 *           { "content": "Obtain US birth certificate (certified copy)" }
 *         ]
 *       }
 *     ]
 *   }
 */
router.post('/scaffold', async (req: Request, res: Response) => {
  try {
    const { projectName, tasks } = req.body;
    if (!projectName) {
      return res.status(400).json({ success: false, error: 'projectName is required' });
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ success: false, error: 'tasks must be a non-empty array' });
    }
    const todoist = getTodoistService();
    const result = await todoist.scaffoldProject(projectName, tasks);
    console.log(
      `[TODOIST] Scaffolded project "${result.project.name}" with ${result.tasks.length} parent task(s)`
    );
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    console.error('[TODOIST] POST /scaffold error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
