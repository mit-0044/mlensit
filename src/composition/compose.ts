import { TsMorphAnalyzer } from '@mlensit/analyzer';
import {
  AnalyzeCodebaseUseCase,
  GenerateReportUseCase,
  GenerateTestsUseCase,
  MeasureCoverageUseCase,
  RunTestsUseCase,
  ScanProjectUseCase,
} from '@mlensit/core';
import { FileReporter } from '@mlensit/reporter';
import { NodeProjectScanner } from '@mlensit/scanner';
import { ConsoleLogger, type Logger } from '@mlensit/shared';
import { VitestTestGenerator } from '@mlensit/test-generator';
import { VitestCoverageMeasurer, VitestTestRunner } from '@mlensit/test-runner';

/**
 * The use cases the CLI drives, wired to concrete port implementations.
 * Constructed once at startup by {@link compose}.
 */
export interface Pipeline {
  readonly analyzeCodebase: AnalyzeCodebaseUseCase;
  readonly generateTests: GenerateTestsUseCase;
  readonly runTests: RunTestsUseCase;
  readonly generateReport: GenerateReportUseCase;
}

/**
 * The composition root's output: a fully wired {@link Pipeline}, the
 * {@link Logger} it and the CLI commands share, and the standalone
 * {@link MeasureCoverageUseCase} that backs `mlensit test --coverage`
 * (Milestone 12) — not part of `Pipeline` since it's an opt-in add-on
 * to `test`, not one of the four main commands' own pipeline stages.
 */
export interface Composition {
  readonly pipeline: Pipeline;
  readonly measureCoverage: MeasureCoverageUseCase;
  readonly logger: Logger;
}

/**
 * The CLI's composition root. Wires infrastructure adapters into the
 * domain's use cases. This is the only place in MLensIT allowed to
 * construct concrete port implementations, per
 * `docs/architecture/overview.md`'s dependency rules.
 *
 * Project scanning (`@mlensit/scanner`, Milestone 2), AST parsing
 * (`@mlensit/analyzer`, Milestone 3), test generation
 * (`@mlensit/test-generator`, Milestone 7), test execution and
 * coverage measurement (`@mlensit/test-runner`, Milestones 11-12), and
 * report generation (`@mlensit/reporter`, Milestone 19) are all wired
 * to their real adapters.
 */
export function compose(): Composition {
  const logger = new ConsoleLogger();

  const scanProjectUseCase = new ScanProjectUseCase(new NodeProjectScanner(), logger);

  const pipeline: Pipeline = {
    analyzeCodebase: new AnalyzeCodebaseUseCase(
      scanProjectUseCase,
      new TsMorphAnalyzer(),
      logger,
    ),
    generateTests: new GenerateTestsUseCase(new VitestTestGenerator(), logger),
    runTests: new RunTestsUseCase(new VitestTestRunner(), logger),
    generateReport: new GenerateReportUseCase(new FileReporter(), logger),
  };

  const measureCoverage = new MeasureCoverageUseCase(new VitestCoverageMeasurer(), logger);

  return { pipeline, measureCoverage, logger };
}
