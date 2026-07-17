import {
  selectAffectedFiles,
  selectAffectedSuites,
  type AnalysisResult,
  type AnalyzerPlugin,
  type Report,
  type TestResult,
  type TestSuite,
} from '@mlensit/core';
import type { PipelineStage } from '@mlensit/dashboard';
import { isErr, ok, type MLensITError, type Result } from '@mlensit/shared';
import type { Pipeline } from './compose.js';

export type { PipelineStage };

/**
 * Invoked once a pipeline stage completes successfully, naming which
 * one — `mlensit report`'s live-progress dashboard (`formatProgressHtml`)
 * uses this to update what it's serving as the run proceeds. Optional
 * everywhere it's accepted below, so every existing caller is
 * unaffected unless it opts in.
 */
export type OnStageComplete = (stage: PipelineStage) => void;

/**
 * Runs the analysis stage of the pipeline for `projectPath`. `plugins`
 * (loaded via `loadPlugins`, e.g. from `mlensit.config.json`) are
 * forwarded to {@link AnalyzeCodebaseUseCase}; defaulting to none keeps
 * every other pipeline stage (`generate`/`test`/`report`, all of which
 * start from this same function) unaffected unless a caller explicitly
 * opts in.
 */
export async function analyzeProject(
  pipeline: Pipeline,
  projectPath: string,
  plugins: readonly AnalyzerPlugin[] = [],
  onStageComplete?: OnStageComplete,
): Promise<Result<AnalysisResult, MLensITError>> {
  const result = await pipeline.analyzeCodebase.execute(projectPath, plugins);
  if (!isErr(result)) {
    onStageComplete?.('analyze');
  }
  return result;
}

/**
 * Runs analysis, then generates test suites from its resulting
 * {@link CodeGraph}. `plugins` (e.g. the AI plugin resolved by
 * `resolveAiPlugin`) are forwarded to the analysis step; they default
 * to none so every existing caller is unaffected. Short-circuits and
 * propagates the failure if analysis fails.
 */
export async function generateSuites(
  pipeline: Pipeline,
  projectPath: string,
  plugins: readonly AnalyzerPlugin[] = [],
  onStageComplete?: OnStageComplete,
): Promise<Result<{ analysis: AnalysisResult; suites: TestSuite[] }, MLensITError>> {
  const analysisResult = await analyzeProject(pipeline, projectPath, plugins, onStageComplete);
  if (isErr(analysisResult)) {
    return analysisResult;
  }

  const suitesResult = await pipeline.generateTests.execute(analysisResult.value.graph);
  if (isErr(suitesResult)) {
    return suitesResult;
  }
  onStageComplete?.('generate');

  return ok({ analysis: analysisResult.value, suites: suitesResult.value });
}

/**
 * Runs analysis and generation, then executes the resulting test suites.
 * `plugins` are forwarded to the analysis step (see {@link generateSuites}).
 * Short-circuits and propagates the failure from any earlier stage.
 */
export async function runSuites(
  pipeline: Pipeline,
  projectPath: string,
  plugins: readonly AnalyzerPlugin[] = [],
  onStageComplete?: OnStageComplete,
): Promise<
  Result<{ analysis: AnalysisResult; suites: TestSuite[]; testResults: TestResult[] }, MLensITError>
> {
  const generated = await generateSuites(pipeline, projectPath, plugins, onStageComplete);
  if (isErr(generated)) {
    return generated;
  }

  const runResult = await pipeline.runTests.execute(generated.value.suites, projectPath);
  if (isErr(runResult)) {
    return runResult;
  }
  onStageComplete?.('test');

  return ok({
    analysis: generated.value.analysis,
    suites: generated.value.suites,
    testResults: runResult.value,
  });
}

/**
 * Runs analysis and generation, then executes only the test suites
 * affected by `changedFilePaths` (via {@link selectAffectedFiles} and
 * {@link selectAffectedSuites}) — the scoped rerun `mlensit test
 * --watch` (Milestone 13) performs on each file-change event, instead
 * of {@link runSuites}'s whole-project run. Short-circuits and
 * propagates the failure from any earlier stage.
 */
export async function runAffectedSuites(
  pipeline: Pipeline,
  projectPath: string,
  changedFilePaths: readonly string[],
): Promise<
  Result<{ analysis: AnalysisResult; suites: TestSuite[]; testResults: TestResult[] }, MLensITError>
> {
  const generated = await generateSuites(pipeline, projectPath);
  if (isErr(generated)) {
    return generated;
  }

  const affectedFiles = selectAffectedFiles(generated.value.analysis.graph, changedFilePaths);
  const affectedSuites = selectAffectedSuites(generated.value.suites, affectedFiles);

  const runResult = await pipeline.runTests.execute(affectedSuites, projectPath);
  if (isErr(runResult)) {
    return runResult;
  }

  return ok({
    analysis: generated.value.analysis,
    suites: affectedSuites,
    testResults: runResult.value,
  });
}

/**
 * Runs the full pipeline (analyze, generate, run) and composes the final
 * {@link Report}. `plugins` are forwarded to the analysis step (see
 * {@link generateSuites}). `onStageComplete`, if given, fires once per
 * stage — `analyze`, `generate`, `test`, then `report` — as each
 * completes. Short-circuits and propagates the failure from any earlier
 * stage.
 */
export async function buildReport(
  pipeline: Pipeline,
  projectPath: string,
  plugins: readonly AnalyzerPlugin[] = [],
  onStageComplete?: OnStageComplete,
): Promise<Result<Report, MLensITError>> {
  const executed = await runSuites(pipeline, projectPath, plugins, onStageComplete);
  if (isErr(executed)) {
    return executed;
  }

  const reportResult = await pipeline.generateReport.execute(
    executed.value.analysis,
    executed.value.testResults,
    projectPath,
  );
  if (isErr(reportResult)) {
    return reportResult;
  }
  onStageComplete?.('report');

  return reportResult;
}
