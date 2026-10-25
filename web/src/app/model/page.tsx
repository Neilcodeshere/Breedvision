import type { Metadata } from "next";

import { Container, Section } from "@/components/layout/Container";
import { SiteFooter } from "@/components/navigation/SiteFooter";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { T } from "@/i18n";

export const metadata: Metadata = {
  title: "Model facts",
  description:
    "What the BreedVision model is, how it was tested, and where it falls short.",
};

/*
 * Every figure below is copied from docs/test-evaluation.md, which is generated
 * from ml/training/test_eval.py. Update both together; do not edit a number here
 * without re-running the evaluation.
 */
const RESULTS = [
  { metric: "Top-1 accuracy", baseline: "59.3%", deployed: "61.9%", note: "95% CI 58.8–64.6" },
  { metric: "Top-3 accuracy", baseline: "81.6%", deployed: "83.0%", note: "right breed among the top three" },
  { metric: "Top-5 accuracy", baseline: "90.0%", deployed: "90.5%", note: "" },
  { metric: "Macro-F1", baseline: "0.556", deployed: "0.583", note: "every breed weighted equally" },
];

const BANDS = [
  { band: "Confident (≥ 85%)", share: "24.4%", acc: "90.1%", means: "The app names one breed." },
  { band: "Uncertain", share: "66.1%", acc: "57.1%", means: "The app lists candidates and names none." },
  { band: "Low (< 30%)", share: "9.5%", acc: "23.6%", means: "The app asks for a better photo." },
];

const LIMITS = [
  "Tested on photos from the same kind of web sources as the training photos. Field photos (poor light, partial views, dirty animals) are likely harder and have not been measured.",
  "49 cattle breeds only. There are no buffalo in the dataset, so buffalo are not identified.",
  "Some breeds are weak: dagri, gaolao, kherigarh, gangatari and Krishna Valley score under 0.3 F1.",
  "The “not cattle” check flags unrelated pictures but has not been shown to reject other animals such as dogs, horses or buffalo.",
  "Fine-tuning improved test top-1 by 2.7 points (paired 95% interval +0.5 to +4.9). That is a modest gain, not a large one.",
  "The test set was scored twice, once per model. Nothing was chosen or tuned from either result.",
];

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[32rem] text-left text-small">
        <thead className="border-b border-line bg-paper-sunk text-micro uppercase tracking-[0.12em] text-ink-3">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={String(r[0])}>
              {r.map((c, i) => (
                <td
                  key={i}
                  data-numeric={i > 0 && i < 3 ? "" : undefined}
                  className={i === 0 ? "px-4 py-3 font-medium text-ink" : "px-4 py-3 text-ink-2"}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ModelFactsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Section spacing="tight">
          <Container width="text">
            <h1 className="text-title font-semibold tracking-tight text-ink">
              <T k="model.title" />
            </h1>
            <p className="mt-2 max-w-xl text-body text-ink-2 text-pretty">
              What the model is, how it was tested, and where it falls short.
              The numbers below were measured, not estimated.
            </p>

            <h2 className="mt-12 text-body font-semibold text-ink">What it is</h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-small text-ink-2">
              <li>An image classifier: EfficientNet-B0 pretrained on ImageNet, with its last three blocks fine-tuned on cattle photos and a linear layer that picks one of 49 Indian cattle breeds.</li>
              <li>7,799 photos after cleaning: 5,570 to train, 1,115 to choose settings, 1,114 held back for the final test.</li>
              <li>Photos that look alike were kept together on one side of the split. A plain random split would have leaked 609 near-duplicate pairs between training and test; this one leaks none.</li>
              <li>Photos filed under more than one breed (216) and one non-Indian breed were removed.</li>
              <li>It runs on a CPU in about 0.05 seconds per photo. It is a classifier, not a detector: it does not find the animal in the frame.</li>
            </ul>

            <h2 className="mt-12 text-body font-semibold text-ink">
              Final test results (1,114 unseen photos)
            </h2>
            <div className="mt-4">
              <Table
                head={["Measure", "Before fine-tuning", "Deployed model", "Note"]}
                rows={RESULTS.map((r) => [r.metric, r.baseline, r.deployed, r.note])}
              />
            </div>
            <p className="mt-3 text-small text-ink-3 text-pretty">
              Chance is about 2% for 49 breeds. Many of these breeds look very
              alike, which is why the top-3 figure is much higher than top-1.
            </p>

            <h2 className="mt-12 text-body font-semibold text-ink">
              Why the app often says “uncertain”
            </h2>
            <p className="mt-2 text-small text-ink-2 text-pretty">
              The app only names a breed when the model is confident enough
              that it is right about 9 times in 10. On the test photos:
            </p>
            <div className="mt-4">
              <Table
                head={["Confidence", "Share of photos", "Right when so", "What the app does"]}
                rows={BANDS.map((b) => [b.band, b.share, b.acc, b.means])}
              />
            </div>

            <h2 className="mt-12 text-body font-semibold text-ink">Limits</h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-small text-ink-2">
              {LIMITS.map((l) => (
                <li key={l} className="text-pretty">
                  {l}
                </li>
              ))}
            </ul>

            <p className="mt-10 text-micro text-ink-3 text-pretty">
              Full write-up: docs/test-evaluation.md in the project repository.
              This is a research prototype. Predictions are advisory and should
              be confirmed by a qualified assessor.
            </p>
          </Container>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
