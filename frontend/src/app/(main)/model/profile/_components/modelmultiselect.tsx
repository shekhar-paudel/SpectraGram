"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown, Search } from "lucide-react";

/* Fetch list from proxy */
async function fetchModelList(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch("/api/model_list", { method: "GET", signal });
  if (!res.ok) throw new Error(`model_list failed: ${res.status}`);
  return res.json();
}

/* tiny fuzzy top-10 */
function fuzzyTop(ids: string[], query: string, limit = 10): string[] {
  if (!query.trim()) return ids.slice(0, limit);
  const q = query.toLowerCase();
  const scored = ids.map((id) => {
    const s = id.toLowerCase();
    const idx = s.indexOf(q);
    if (idx >= 0) return { id, score: idx + s.length * 0.001 };
    let i = 0, j = 0, gaps = 0, last = -1;
    while (i < s.length && j < q.length) {
      if (s[i] === q[j]) {
        if (last >= 0) gaps += i - last - 1;
        last = i;
        j++;
      }
      i++;
    }
    const missPenalty = (q.length - j) * 10;
    const gapPenalty = gaps * 0.1;
    return { id, score: 1000 + missPenalty + gapPenalty + s.length * 0.001 };
  });
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.id);
}

export default function ModelMultiSelect({
  baseId,             // <- primary model (preselected & locked)
  values,
  onChange,
  maxSelect = 3,      // number of *additional* models (does not count base)
}: {
  baseId?: string;
  values: string[];
  onChange: (ids: string[]) => void;
  maxSelect?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [allIds, setAllIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // ensure baseId is NOT part of 'values'
  React.useEffect(() => {
    if (!baseId) return;
    if (values.includes(baseId)) {
      onChange(values.filter((v) => v !== baseId));
    }
  }, [baseId]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
  const controller = new AbortController();
  let active = true;

  (async () => {
    try {
      setLoading(true);
      const ids = await fetchModelList(controller.signal);
      if (!active) return;
      setAllIds(ids);
      setError(null);
    } catch (e: any) {
      if (e?.name === "AbortError" || /aborted/i.test(e?.message)) return;
      if (!active) return;
      setError(e?.message || "Failed to load model list");
    } finally {
      if (active) setLoading(false);
    }
  })();

  return () => {
    active = false;
    controller.abort();
  };
}, []);

  const top = React.useMemo(() => fuzzyTop(allIds, query, 10), [allIds, query]);

  const toggle = (id: string) => {
    if (id === baseId) return; // primary is locked
    const set = new Set(values);
    if (set.has(id)) {
      set.delete(id);
    } else {
      if (values.length >= maxSelect) return; // cap additional selections
      set.add(id);
    }
    onChange(Array.from(set));
  };

  const totalSelected = (baseId ? 1 : 0) + values.length;

  return (
    <div className="w-full flex justify-center">
      <div className="w-full max-w-xs">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              role="combobox"
              className="w-full justify-between"
              title={`Primary + up to ${maxSelect} comparisons`}
              disabled={!allIds.length}
            >
              <div className="flex items-center gap-2 truncate">
                <Search className="h-4 w-4 opacity-70" />
                <span className="truncate">
                  {loading
                    ? "Loading compare list…"
                    : error
                      ? "Error loading models"
                      : totalSelected > 0
                        ? `${totalSelected} selected`
                        : "Select up to 3 to compare"}
                </span>
              </div>
              <ChevronsUpDown className="ml-2 h-4 w-4 opacity-70" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="center"
          >
            <Command>
              <CommandInput
                placeholder="Search models…"
                value={query}
                onValueChange={setQuery}
              />
              <CommandEmpty>No models found.</CommandEmpty>
              <CommandList>
                <CommandGroup heading="Top matches">
                  {top.map((id) => {
                    const isPrimary = id === baseId;
                    const checked = isPrimary ? true : values.includes(id);
                    const lockOut = !checked && values.length >= maxSelect;
                    return (
                      <CommandItem
                        key={id}
                        value={id}
                        onSelect={() => (!isPrimary && !lockOut) && toggle(id)}
                        className={`cursor-pointer flex items-center gap-2 ${lockOut && !isPrimary ? "opacity-50" : ""}`}
                        aria-disabled={isPrimary}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={isPrimary}
                          onCheckedChange={() => toggle(id)}
                        />
                        <span className="truncate">
                          {id}{isPrimary ? " (primary)" : ""}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="mt-1 text-center text-[11px] text-muted-foreground">
          Select additional models to compare with the primary.
        </div>
      </div>
    </div>
  );
}
