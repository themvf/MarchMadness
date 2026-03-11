import type { TeamProfileRow } from "@/db/queries";
import { getArchetypes, archetypeBadgeClass } from "@/lib/archetypes";

export function ArchetypeBadges({
  profile,
  max = 4,
}: {
  profile: TeamProfileRow | undefined;
  max?: number;
}) {
  const archetypes = getArchetypes(profile).slice(0, max);
  if (archetypes.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap gap-1">
      {archetypes.map((a) => (
        <span
          key={a.label}
          title={a.tip}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${archetypeBadgeClass(a.kind)}`}
        >
          {a.label}
        </span>
      ))}
    </span>
  );
}
