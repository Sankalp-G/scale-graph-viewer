import { Button } from "~/components/ui/button";

type SelectionCardProps = {
  selected: string[];
  onClearSelection?: () => void;
  disabled?: boolean;
};

export default function SelectionCard({
  selected,
  onClearSelection,
  disabled,
}: SelectionCardProps) {
  return (
    <section className="w-full max-w-xs overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Selected cameras
        </p>
        <Button size="sm" variant="secondary" onClick={onClearSelection} disabled={disabled}>
          Clear selection
        </Button>
      </div>
      <div className="px-4 py-3">
        {selected.length > 0 ? (
          <ul className="max-h-40 space-y-1 overflow-auto pr-2 text-sm">
            {selected.map((name) => (
              <li key={name} className="rounded-md bg-muted/40 px-2 py-1">
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No cameras filtered.</p>
        )}
      </div>
    </section>
  );
}
