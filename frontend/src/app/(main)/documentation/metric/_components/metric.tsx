"use client";

import { useState } from "react";
import { BlockMath, InlineMath } from "react-katex";
import "katex/dist/katex.min.css";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Scale, Heart, Users } from "lucide-react";

/** Scrollable wrapper for display math to avoid overflow on small screens */
function MathBlock({ math }: { math: string }) {
  return (
    <div className="overflow-x-auto -mx-2 px-2 md:mx-0 md:px-0">
      <BlockMath math={math} />
    </div>
  );
}

export default function FairnessMetric() {
  const [activeTab, setActiveTab] = useState<"fairness" | "generosity" | "public-service">("fairness");

  return (
    <div className="container mx-auto px-4 py-10">
      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        <Button
          variant={activeTab === "fairness" ? "default" : "outline"}
          size="sm"
          className="flex flex-1 items-center gap-2"
          onClick={() => setActiveTab("fairness")}
        >
          <Scale size={16} /> Fairness
        </Button>

        <Button
          variant={activeTab === "generosity" ? "default" : "outline"}
          size="sm"
          className="flex flex-1 items-center gap-2"
          onClick={() => setActiveTab("generosity")}
        >
          <Heart size={16} /> Generosity
        </Button>

        <Button
          variant={activeTab === "public-service" ? "default" : "outline"}
          size="sm"
          className="flex flex-1 items-center gap-2"
          onClick={() => setActiveTab("public-service")}
        >
          <Users size={16} /> Public Service
        </Button>
      </div>

      {activeTab === "fairness" && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Fairness Metrics for Instructor Grading Using Earth Mover&apos;s Distance</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm sm:prose-base dark:prose-invert max-w-full break-words">
            <h2>Abstract</h2>
            <p>
              This work presents a data-driven fairness metric for evaluating individual instructors&apos; grading
              distributions in relation to broader institutional norms. By comparing an instructor’s letter grade
              distribution to that of the entire university and their respective department, we derive a normalized
              distance score using <em>Earth Mover’s Distance (EMD)</em>. The resulting score is then mapped to a
              fairness grade (A–F) based on precomputed percentile thresholds. This allows for consistent and
              interpretable comparisons of grading behavior across a large set of faculty and departments.
            </p>

            <h2>Methodology</h2>
            <ul>
              <li>
                <InlineMath math={"G = [g_1, g_2, \\ldots, g_n]"} /> — the ordered set of grades:
                <MathBlock
                  math={
                    "G = [\\text{A}^+, \\text{A}, \\text{A}^-, \\text{B}^+, \\text{B}, \\text{B}^-, \\text{C}^+, \\text{C}, \\text{C}^-, \\text{D}^+, \\text{D}, \\text{D}^-, \\text{F}]"
                  }
                />
              </li>
              <li>
                <InlineMath math={"P = [p_1, p_2, \\ldots, p_n]"} />: instructor’s grade distribution
              </li>
              <li>
                <InlineMath math={"Q = [q_1, q_2, \\ldots, q_n]"} />: reference (university/department)
              </li>
            </ul>

            <h3>Step 1: Normalize Grade Distributions</h3>
            <MathBlock math={"p_i = \\frac{\\text{count of grade } g_i}{\\sum_{j=1}^n \\text{count of grade } g_j}"} />

            <h3>Step 2: Compute Earth Mover’s Distance (EMD)</h3>
            <MathBlock math={"\\text{EMD}(P, Q) = \\sum_{i=1}^{n} \\left| \\sum_{j=1}^{i} (p_j - q_j) \\right|"} />

            <h3>Step 3: Normalize to Percentile-Based Grading</h3>
            <p>
              Given EMD scores <InlineMath math={"\\{d_1, d_2, \\ldots, d_n\\}"} />, compute:
            </p>
            <MathBlock math={"p_{20}, p_{40}, p_{60}, p_{80}"} />
            <p>Define bins:</p>
            <MathBlock
              math={`
              [0, p_{20}) \\rightarrow \\text{A},\\quad
              [p_{20}, p_{40}) \\rightarrow \\text{B},\\quad
              [p_{40}, p_{60}) \\rightarrow \\text{C},\\quad
              [p_{60}, p_{80}) \\rightarrow \\text{D},\\quad
              [p_{80}, \\infty) \\rightarrow \\text{F}`}
            />

            <h3>Step 4: Assigning Grades Using Thresholds</h3>
            <p>Let:</p>
            <MathBlock math={`T = \\{t_0 = 0.0, t_1, t_2, t_3, t_4, t_5 = \\infty\\}`} />
            <MathBlock
              math={`
              \\text{Grade}(d) =
              \\begin{cases}
                \\text{A} & \\text{if } d \\in [t_0, t_1) \\\\
                \\text{B} & \\text{if } d \\in [t_1, t_2) \\\\
                \\text{C} & \\text{if } d \\in [t_2, t_3) \\\\
                \\text{D} & \\text{if } d \\in [t_3, t_4) \\\\
                \\text{F} & \\text{if } d \\in [t_4, t_5)
              \\end{cases}`}
            />

            <h2>Example Use Case</h2>
            <p>Instructor X&apos;s distribution:</p>
            <MathBlock math={"P_X = \\{0.2, 0.3, 0.1, 0.15, 0.1, 0.05, \\ldots\\}"} />
            <p>University distribution:</p>
            <MathBlock math={"Q = \\{0.1, 0.25, 0.15, 0.2, 0.1, 0.1, \\ldots\\}"} />
            <MathBlock math={"\\text{EMD}(P_X, Q) = \\sum_{i=1}^{n} |CDF_P(i) - CDF_Q(i)|"} />
            <p>
              If <InlineMath math={"d_X = 0.87"} /> and thresholds are:
            </p>
            <MathBlock math={"[0.0, 0.6), [0.6, 0.9), [0.9, 1.2), [1.2, 1.5), [1.5, \\infty)"} />
            <p>
              Then <InlineMath math={"d_X \\in [0.6, 0.9) \\Rightarrow \\text{Grade} = \\text{B}"} />
            </p>
          </CardContent>
        </Card>
      )}

      {activeTab === "generosity" && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Generosity Metrics for Instructor Grading Using Signed Earth Mover&apos;s Distance</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm sm:prose-base dark:prose-invert max-w-full break-words">
            <h2>Abstract</h2>
            <p>
              The generosity metric evaluates whether an instructor’s grading distribution is{" "}
              <em>more generous</em> or <em>harsher</em> than institutional norms. Unlike fairness (which uses unsigned
              EMD), this metric uses a <strong>signed Earth Mover’s Distance (sEMD)</strong> where the sign indicates
              the direction of the shift.
            </p>

            <h2>Methodology</h2>
            <ul>
              <li>
                Grade set <InlineMath math={"G = [g_1, g_2, \\ldots, g_n]"} /> ordered from high to low.
              </li>
              <li>
                Instructor’s distribution: <InlineMath math={"P = [p_1, p_2, \\ldots, p_n]"} />
              </li>
              <li>
                Reference distribution: <InlineMath math={"Q = [q_1, q_2, \\ldots, q_n]"} />
              </li>
            </ul>

            <h3>Step 1: Normalize Grade Distributions</h3>
            <MathBlock math={"p_i = \\frac{\\text{count}(g_i)}{\\sum_j \\text{count}(g_j)}"} />

            <h3>Step 2: Signed Earth Mover’s Distance</h3>
            <p>We compute the signed component using cumulative differences:</p>
            <MathBlock math={"s = \\frac{1}{n} \\sum_{i=1}^{n} \\sum_{j=1}^{i} (p_j - q_j)"} />
            <p>The final signed EMD is:</p>
            <MathBlock math={"\\text{sEMD}(P,Q) = \\operatorname{sign}(s) \\cdot \\text{EMD}(P,Q)"} />

            <h3>Step 3: Interpretation</h3>
            <ul>
              <li>
                <InlineMath math={"\\text{sEMD} > 0"} /> → distribution is shifted towards higher grades (more generous)
              </li>
              <li>
                <InlineMath math={"\\text{sEMD} \\approx 0"} /> → grading is similar to reference (average)
              </li>
              <li>
                <InlineMath math={"\\text{sEMD} < 0"} /> → distribution is shifted towards lower grades (harsher)
              </li>
            </ul>

            <h3>Step 4: Mapping to Grades</h3>
            <p>
              Thresholds <InlineMath math={"T = [t_0, t_1, t_2, t_3, t_4]"} /> are computed dynamically from percentile
              bins.
            </p>
            <MathBlock
              math={`
              (-\\infty, t_1) \\rightarrow \\text{D}, \\quad
              [t_1, t_2) \\rightarrow \\text{C}, \\quad
              [t_2, t_3) \\rightarrow \\text{B}, \\quad
              [t_3, \\infty) \\rightarrow \\text{A}`}
            />

            <h2>Example Calculation</h2>
            <p>
              For instructor <InlineMath math={"X"} />, with:
            </p>
            <MathBlock math={"P_X = \\{0.3, 0.25, 0.15, 0.1, 0.1, 0.1\\}"} />
            <p>and university reference:</p>
            <MathBlock math={"Q = \\{0.2, 0.3, 0.2, 0.1, 0.1, 0.1\\}"} />
            <p>
              If <InlineMath math={"\\text{sEMD}(P_X,Q) = 0.35"} /> and thresholds are:
            </p>
            <MathBlock math={"[-0.4, -0.1, 0.1, 0.4]"} />
            <p>
              Then <InlineMath math={"0.35 \\in [0.1, 0.4) \\Rightarrow \\text{Grade} = \\text{B}"} />
            </p>
          </CardContent>
        </Card>
      )}

      {activeTab === "public-service" && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Public Service Metric Using Signed Log-Odds of Pass Rates</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm sm:prose-base dark:prose-invert max-w-full break-words">
            <h2>Abstract</h2>
            <p>
              The Public Service metric evaluates whether an instructor supports student success by comparing their{" "}
              <strong>pass rate</strong> to institutional norms. Unlike fairness or generosity, this metric focuses
              purely on the proportion of students who pass the course, using a <strong>signed log-odds ratio</strong>{" "}
              to capture differences in both magnitude and direction.
            </p>

            <h2>Methodology</h2>
            <ul>
              <li>
                Define passing grades: <InlineMath math={"P = \\{A^+, A, A^-, B^+, B, B^-, C^+, C, C^-\\}"} />.
              </li>
              <li>
                Instructor pass rate: <InlineMath math={"r_P = \\sum_{g \\in P} p_g"} />.
              </li>
              <li>
                Reference (university/department) pass rate: <InlineMath math={"r_Q = \\sum_{g \\in P} q_g"} />.
              </li>
            </ul>

            <h3>Step 1: Compute Log-Odds</h3>
            <p>Convert pass rates to log-odds to stabilize the scale:</p>
            <MathBlock math={"L(r) = \\log\\left(\\frac{r}{1 - r}\\right)"} />

            <h3>Step 2: Signed Log-Odds Difference</h3>
            <p>The metric is computed as:</p>
            <MathBlock math={"\\text{sLOD}(P,Q) = L(r_P) - L(r_Q)"} />

            <h3>Step 3: Interpretation</h3>
            <ul>
              <li>
                <InlineMath math={"\\text{sLOD} > 0"} /> → higher pass rate than reference (better public service)
              </li>
              <li>
                <InlineMath math={"\\text{sLOD} \\approx 0"} /> → similar to reference (average service)
              </li>
              <li>
                <InlineMath math={"\\text{sLOD} < 0"} /> → lower pass rate (worse public service)
              </li>
            </ul>

            <h3>Step 4: Mapping to Grades</h3>
            <p>
              Define dynamic thresholds <InlineMath math={"T = [t_0, t_1, t_2, t_3, t_4]"} />:
            </p>
            <MathBlock
              math={`
        (-\\infty, t_1) \\rightarrow \\text{D}, \\quad
        [t_1, t_2) \\rightarrow \\text{C}, \\quad
        [t_2, t_3) \\rightarrow \\text{B}, \\quad
        [t_3, \\infty) \\rightarrow \\text{A}`}
            />

            <h2>Example Calculation</h2>
            <p>
              Suppose instructor <InlineMath math={"X"} /> has a pass rate:
            </p>
            <MathBlock math={"r_P = 0.85"} />
            <p>while the department reference pass rate is:</p>
            <MathBlock math={"r_Q = 0.70"} />
            <p>Then:</p>
            <MathBlock math={"L(r_P) = \\log(0.85 / 0.15) = 1.73"} />
            <MathBlock math={"L(r_Q) = \\log(0.70 / 0.30) = 0.85"} />
            <MathBlock math={"\\text{sLOD} = 1.73 - 0.85 = 0.88"} />
            <p>If thresholds are:</p>
            <MathBlock math={"[-2.0, -0.5, 0.0, 0.5, 2.0]"} />
            <p>
              Then <InlineMath math={"0.88 \\in [0.5, 2.0) \\Rightarrow \\text{Grade} = \\text{B}"} />
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
