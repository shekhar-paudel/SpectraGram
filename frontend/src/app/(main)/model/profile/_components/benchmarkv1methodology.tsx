"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export default function BenchmarkV1Methodology({
  evalVersion,
  className,
}: {
  evalVersion: string | null;
  className?: string;
}) {
  const version = evalVersion ?? "v1";
  const title = "Evaluation Methodology Summary — Version: ";

  const v1Bullets: Array<React.ReactNode> = [
    <>
      <strong>Standardize inputs:</strong> mono <strong>16 kHz PCM</strong> via <code>ffmpeg</code>; text normalize (
      <em>lowercase</em>, strip tags like <code>[noise]</code>, remove punctuation, collapse whitespace).
    </>,
    <>
      <strong>Robustness variants:</strong> generate reverberant audio by convolving with <em>RIRs</em> (normalized to <strong>−3 dBFS</strong>).
    </>,
    <>
      <strong>Fixed load profile:</strong> <code>concurrency=4</code>, <code>~2 RPS</code>; record per-utterance end-to-end latency (<em>ms</em>) and audio duration (<em>s</em>).
    </>,
    <>
      <strong>Quality metric:</strong> corpus <strong>WER</strong> via <em>DP alignment</em>; aggregate <strong>S/D/I</strong> over all utterances → <code>WER = (S + D + I) / N</code>.
    </>,
    <>
      <strong>Speed metrics:</strong> latency <code>p50</code> and <code>p95</code> from the empirical distribution.
    </>,
    <>
      <strong>Throughput metric:</strong> <code>RTF</code> per utt = <code>(lat_ms/1000)/duration_s</code>; report <strong>mean</strong> and <strong>p95</strong>.
    </>,
    <>
      <strong>Uncertainty:</strong> percentile bootstrap (<strong>1,000</strong> resamples, <strong>95% CI</strong>, <code>seed=42</code>) for WER, latency quantiles, and RTF; add small-N <em>order-stat</em> CIs for quantiles.
    </>,
    <>
      <strong>Bucketing &amp; storage:</strong> compute per <code>(dataset, variant)</code>; persist <code>MetricSummary</code> and <code>BootstrapResult</code> for auditable reports.
    </>,
  ];

  const bullets = version === "v1"
    ? v1Bullets
    : [
        <>
          <strong>No methodology text registered for “{version}”.</strong>{" "}
          <span className="italic">Select v1 or add a policy mapping to display its 1-minute methodology here.</span>
        </>,
      ];

  return (
    <Card
      className={cn(
        // full-width, no max-width caps (expands with viewport/parent)
        "w-full",
        // match other cards’ gradient skin
        "relative overflow-hidden h-full shadow-xs border border-border",
        "bg-gradient-to-t from-primary/5 to-card dark:bg-card",
        className
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm sm:text-base">
          <span className="font-semibold">{title}</span>
          <Badge variant="outline" className="uppercase tracking-wide">{version}</Badge>
        </CardTitle>
      </CardHeader>

      <Separator className="opacity-60" />

      <CardContent className="pt-4">
        {/* two columns on wider screens; bullets don’t break */}
        <ul className="text-sm sm:text-[0.95rem] md:text-base text-foreground/90 list-disc pl-5 space-y-2 lg:space-y-2.5 md:columns-2 md:[&>li]:break-inside-avoid">
          {bullets.map((node, i) => (
            <li key={i} className="leading-relaxed">
              {node}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
