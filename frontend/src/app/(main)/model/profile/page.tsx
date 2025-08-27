// src\app\(main)\model\profile\page.tsx
"use client";

import * as React from "react";
import ModelDropdown from "./_components/modeldropdown";
import EvaluationDropdown from "./_components/evaluationdropdown";
import ModelMultiSelect from "./_components/modelmultiselect";
import ModelProfileCard from "./_components/profilecard";
import AccuracyEvaulation from "./_components/accuracyevaluation";
import PerformanceEvaulation from "./_components/performanceevaulation";
import BenchmarkV1 from "./_components/benchmarkv1";
import BenchmarkV1Methodology from "./_components/benchmarkv1methodology"; // note the folder


export default function Page() {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [compareIds, setCompareIds] = React.useState<string[]>([]); // up to 3
  const [evalVersion, setEvalVersion] = React.useState<string | null>(null);

  const ids = React.useMemo(() => {
    const base = selectedId ? [selectedId] : [];
    const uniq = Array.from(new Set([...base, ...compareIds])).filter(Boolean) as string[];
    return uniq.slice(0, 4);
  }, [selectedId, compareIds]);

  // Build the multi-select node to inject into BenchmarkV1's controls row
  const multiSelectControls = (
    <div className="min-w-[260px]">
      <ModelMultiSelect
        baseId={selectedId ?? undefined}
        values={compareIds}
        onChange={setCompareIds}
        maxSelect={3}
      />
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-6 md:gap-8">
      {/* Primary model picker */}
      <ModelDropdown value={selectedId} onChange={setSelectedId} />

      {/* Model profile */}
      <div className="w-full">
        <ModelProfileCard selectedId={selectedId} />
      </div>

      {/* Evaluation selector row: big title on LEFT, dropdown on RIGHT */}
      <div className="w-full flex justify-center">
        <div className="w-full max-w-2xl flex items-center gap-4">
          <span className="whitespace-nowrap text-base md:text-lg font-semibold">Evaluation Version</span>
          <div className="flex-1 max-w-xs">
            <EvaluationDropdown value={evalVersion} onChange={setEvalVersion} />
          </div>
        </div>
      </div>

  {evalVersion && (
      <div className="w-full">
          <BenchmarkV1Methodology evalVersion={evalVersion} />
      </div>
    )}

      {/* Hide everything below until an Evaluation version is selected */}
      {evalVersion && ids.length > 0 && (
        <div className="w-full">
          {/* Pass the multi-select to live alongside Dataset / CI inside BenchmarkV1 */}
          <BenchmarkV1 ids={ids} extraControls={multiSelectControls} />
        </div>
      )}

    

      {/* (Optional) other sections later */}
      {/* <AccuracyEvaulation /> */}
      {/* <PerformanceEvaulation /> */}
    </div>
  );
}
