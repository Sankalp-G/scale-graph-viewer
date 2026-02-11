import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type ExperimentStatus = "idle" | "inprogress";

type ExperimentCardProps = {
  status?: ExperimentStatus;
  activeTimestamp?: string | null;
  onStart?: () => void;
};

const formatElapsed = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((val) => String(val).padStart(2, "0")).join(":");
};

export default function ExperimentCard({
  status,
  activeTimestamp,
  onStart,
}: ExperimentCardProps) {
  const isControlled = status !== undefined;
  const [internalStatus, setInternalStatus] = useState<ExperimentStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const effectiveStatus = status ?? internalStatus;
  const isInProgress = effectiveStatus === "inprogress";

  useEffect(() => {
    if (isInProgress) {
      setStartedAt((prev) => prev ?? Date.now());
    } else {
      setStartedAt(null);
    }
  }, [isInProgress]);

  useEffect(() => {
    if (!isInProgress) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isInProgress]);

  const timeLabel =
    isInProgress && startedAt !== null ? formatElapsed(now - startedAt) : "--:--:--";
  const timestampLabel = isInProgress ? formatTimestamp(activeTimestamp) : "--";

  const handleStart = () => {
    if (isInProgress) {
      return;
    }
    onStart?.();
    if (!isControlled) {
      setInternalStatus("inprogress");
      const now = Date.now();
      setStartedAt(now);
      setNow(now);
    }
  };

  const statusTone = isInProgress
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
    : "border-slate-500/30 bg-slate-500/10 text-slate-600";

  const dotTone = isInProgress ? "bg-emerald-500" : "bg-slate-400";

  return (
    <section className="w-full max-w-xs overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
            statusTone
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", dotTone)} />
          {isInProgress ? "In progress" : "Idle"}
        </span>
        <span className="font-mono text-sm tracking-tight text-muted-foreground">
          {timeLabel}
        </span>
      </div>
      <div className="grid gap-3 px-4 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Active timestamp
          </p>
          <p className="mt-1 text-base font-semibold tracking-tight sm:text-lg">
            {timestampLabel}
          </p>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Button onClick={handleStart} disabled={isInProgress} className="w-full">
          Start
        </Button>
      </div>
    </section>
  );
}
const formatTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const timeParts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const day = getPart(dateParts, "day");
  const month = getPart(dateParts, "month");
  const year = getPart(dateParts, "year");
  const hour = getPart(timeParts, "hour");
  const minute = getPart(timeParts, "minute");
  const dayPeriod = getPart(timeParts, "dayPeriod").toLowerCase();

  return `${day} ${month} ${year}, ${hour}:${minute}${dayPeriod}`;
};
