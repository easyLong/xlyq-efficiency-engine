import type { RequirementEntity } from './entities/requirement.entity';
import type { RequirementItemEntity } from './entities/requirement-item.entity';
import type { TaskEntity } from '../tasks/entities/task.entity';

export function normalizeRequirementSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

export function searchHistoryRequirements<
  T extends Pick<RequirementEntity, 'id' | 'title' | 'requirement_code'>,
>(
  requirements: T[],
  items: Pick<RequirementItemEntity, 'id' | 'requirement_id' | 'item_title'>[],
  tasks: Pick<TaskEntity, 'requirement_item_id' | 'task_name' | 'task_no'>[],
  keyword?: string,
): T[] {
  const terms = normalizeRequirementSearchText(keyword)
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return requirements;

  const fieldsByRequirement = new Map(
    requirements.map((requirement) => [
      requirement.id,
      [requirement.requirement_code, requirement.title].map(
        normalizeRequirementSearchText,
      ),
    ]),
  );
  const requirementByItem = new Map<string, string>();
  for (const item of items) {
    requirementByItem.set(item.id, item.requirement_id);
    fieldsByRequirement
      .get(item.requirement_id)
      ?.push(normalizeRequirementSearchText(item.item_title));
  }
  for (const task of tasks) {
    const requirementId = requirementByItem.get(task.requirement_item_id ?? '');
    if (!requirementId) continue;
    fieldsByRequirement
      .get(requirementId)
      ?.push(
        normalizeRequirementSearchText(task.task_name),
        normalizeRequirementSearchText(task.task_no),
      );
  }
  return requirements.filter((requirement) => {
    const fields = fieldsByRequirement.get(requirement.id) ?? [];
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
}
