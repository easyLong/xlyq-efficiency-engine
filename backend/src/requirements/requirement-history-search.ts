import type { RequirementEntity } from './entities/requirement.entity';
import type { RequirementItemEntity } from './entities/requirement-item.entity';
import type { TaskEntity } from '../tasks/entities/task.entity';

export function normalizeRequirementSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

function hasConfiguredTertiaryCategory(requirement: {
  tertiary_category?: string | null;
  tertiary_category_codes_json?: string | null;
}) {
  if (normalizeRequirementSearchText(requirement.tertiary_category)) return true;
  try {
    const codes = JSON.parse(requirement.tertiary_category_codes_json || '[]');
    return Array.isArray(codes) && codes.length > 0;
  } catch {
    return false;
  }
}

export function searchHistoryRequirements<
  T extends Pick<RequirementEntity, 'id' | 'title' | 'requirement_code'> &
    Partial<
      Pick<
        RequirementEntity,
        | 'secondary_category'
        | 'tertiary_category'
        | 'tertiary_category_codes_json'
      >
    >,
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
      ).concat(
        [
          requirement.secondary_category,
          requirement.tertiary_category,
          requirement.tertiary_category_codes_json,
        ].map(normalizeRequirementSearchText),
      ),
    ]),
  );
  for (const requirement of requirements) {
    const fields = fieldsByRequirement.get(requirement.id);
    if (!fields) continue;
    if (!normalizeRequirementSearchText(requirement.secondary_category)) {
      fields.push(normalizeRequirementSearchText('未分类'));
    }
    if (!hasConfiguredTertiaryCategory(requirement)) {
      fields.push(normalizeRequirementSearchText('未分类'));
    }
  }
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
