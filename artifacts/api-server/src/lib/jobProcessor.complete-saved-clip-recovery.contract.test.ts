import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const processorPaths = [
  ["api-server", new URL("./jobProcessor.ts", import.meta.url)],
  ["worker", new URL("../../../worker/src/lib/jobProcessor.ts", import.meta.url)],
] as const;

function recoveryPreparation(source: string): string {
  const start = source.indexOf("const recoveryMeta = aiMetaOf(job);");
  const end = source.indexOf("// === GENERATING ===", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function finalizationTransaction(source: string): string {
  const start = source.indexOf("const activatedLipSyncChildId = await db.transaction");
  const end = source.indexOf("return childId;", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

/**
 * Source-contract regression tests are intentional here. Importing either
 * processor starts a large provider/storage dependency graph and does not
 * expose processJobInner. These assertions cover both deployed copies and
 * pin the safety ordering around that private orchestration branch.
 */
describe.each(processorPaths)("%s complete saved-clip processor source contract", (_name, url) => {
  const source = readFileSync(fileURLToPath(url), "utf8");

  it("fails closed unless the persisted flag and a complete clip set are both present", () => {
    const preparation = recoveryPreparation(source);
    expect(preparation).toMatch(
      /recoveryMeta\.completeSavedClipRecovery === true\s*&&\s*hasCompleteSavedClipSet\(/,
    );
    expect(preparation).toContain("recoveryMeta.partialClips ?? {}");
    expect(preparation).toContain("recoveryMeta.storyboard?.numClips ?? 0");
  });

  it("skips image preparation and image review only for validated recovery", () => {
    const preparation = recoveryPreparation(source);
    expect(preparation).toMatch(
      /const preparedImages = completeSavedClipRecovery\s*\?\s*\{\}\s*:\s*await prepareNarrativeImages\(job\)/,
    );
    expect(preparation).toContain(
      "if (!completeSavedClipRecovery && isAwaitingImageApproval(reviewMeta))",
    );
  });

  it("checks persisted status and the claim fence before finalization writes", () => {
    const finalization = finalizationTransaction(source);
    const stateRead = finalization.indexOf("const [parentState]");
    const fence = finalization.indexOf("if (", finalization.indexOf("const isCompleteSavedClipRecovery"));
    const videoWrite = finalization.indexOf("await tx.insert(videosTable)");
    const creditWrite = finalization.indexOf(".update(creditsTable)");

    expect(stateRead).toBeGreaterThan(-1);
    expect(finalization).toContain("status: jobsTable.status");
    expect(finalization).toContain("claimedAt: jobsTable.claimedAt");
    expect(finalization).toContain('parentState.status !== "stitching"');
    expect(finalization).toContain("ours === null");
    expect(finalization).toContain("ours !== current");
    expect(fence).toBeGreaterThan(stateRead);
    expect(videoWrite).toBeGreaterThan(fence);
    expect(creditWrite).toBeGreaterThan(videoWrite);
  });

  it("revalidates complete clips from locked state and performs no credit write for recovery", () => {
    const finalization = finalizationTransaction(source);
    expect(finalization).toMatch(
      /parentMeta\.completeSavedClipRecovery === true\s*&&\s*hasCompleteSavedClipSet\(/,
    );
    expect(finalization).toContain("(parentMeta.refunded && !isCompleteSavedClipRecovery)");
    expect(finalization).toMatch(
      /if \(!isCompleteSavedClipRecovery\) \{\s*await tx\s*\.update\(creditsTable\)/,
    );
  });
});