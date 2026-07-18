import {
  unwrapPage,
  normalizeTask,
  normalizeProject,
  filterTasksByLabel,
  TodoistTask,
} from './todoist.service';

describe('todoist.service helpers (api/v1)', () => {
  describe('unwrapPage', () => {
    it('unwraps { results, next_cursor }', () => {
      const { items, nextCursor } = unwrapPage({
        results: [{ id: '1' }],
        next_cursor: 'abc',
      });
      expect(items).toEqual([{ id: '1' }]);
      expect(nextCursor).toBe('abc');
    });

    it('treats bare arrays as a final page (legacy shape)', () => {
      const { items, nextCursor } = unwrapPage([{ id: '1' }, { id: '2' }]);
      expect(items).toHaveLength(2);
      expect(nextCursor).toBeNull();
    });

    it('handles empty / missing results', () => {
      expect(unwrapPage({}).items).toEqual([]);
      expect(unwrapPage({ results: [], next_cursor: null }).nextCursor).toBeNull();
    });
  });

  describe('normalizeTask', () => {
    it('maps checked → is_completed and child_order → order', () => {
      const t = normalizeTask({
        id: 'x',
        content: 'Buy milk',
        checked: true,
        child_order: 7,
      } as TodoistTask);
      expect(t.is_completed).toBe(true);
      expect(t.order).toBe(7);
    });

    it('preserves existing is_completed / order when checked absent', () => {
      const t = normalizeTask({
        id: 'x',
        content: 'Task',
        is_completed: false,
        order: 3,
      });
      expect(t.is_completed).toBe(false);
      expect(t.order).toBe(3);
    });
  });

  describe('normalizeProject', () => {
    it('maps child_order → order', () => {
      expect(normalizeProject({ id: 'p', name: 'Inbox', child_order: 0 }).order).toBe(0);
    });
  });

  describe('filterTasksByLabel', () => {
    const tasks: TodoistTask[] = [
      { id: '1', content: 'A', labels: ['CurrentQuest (ptr.current)'] },
      { id: '2', content: 'B', labels: ['NextImmediateQuest (ptr.next)'] },
      { id: '3', content: 'C', labels: [] },
    ];

    it('returns only tasks with the exact label name', () => {
      expect(filterTasksByLabel(tasks, 'CurrentQuest (ptr.current)').map((t) => t.id)).toEqual([
        '1',
      ]);
      expect(filterTasksByLabel(tasks, 'NextImmediateQuest (ptr.next)').map((t) => t.id)).toEqual([
        '2',
      ]);
      expect(filterTasksByLabel(tasks, 'missing')).toEqual([]);
    });
  });
});
