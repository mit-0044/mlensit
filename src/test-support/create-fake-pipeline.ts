import {
  AnalyzeCodebaseUseCase,
  GenerateReportUseCase,
  GenerateTestsUseCase,
  MeasureCoverageUseCase,
  RunTestsUseCase,
  ScanProjectUseCase,
  type AnalysisPort,
  type CoveragePort,
  type ProjectScannerPort,
  type ReporterPort,
  type TestExecutionPort,
  type TestGenerationPort,
} from '@mlensit/core';
import { ok, type Logger } from '@mlensit/shared';
import type { Composition, Pipeline } from '../composition/compose.js';

/**
 * Fully controllable port implementations for building a test
 * {@link Pipeline} via {@link createFakePipeline}, plus the optional
 * {@link CoveragePort} backing {@link createFakeComposition}'s
 * `measureCoverage` use case.
 */
export interface FakePorts {
  readonly scannerPort: ProjectScannerPort;
  readonly analysisPort: AnalysisPort;
  readonly generationPort: TestGenerationPort;
  readonly executionPort: TestExecutionPort;
  readonly reporterPort: ReporterPort;
  readonly coveragePort?: CoveragePort;
}

const defaultCoveragePort: CoveragePort = {
  measure: async () => ok([]),
};

/**
 * Builds a real {@link Pipeline} (the actual use-case classes) wired to
 * caller-supplied fake ports and logger, so command and pipeline-step
 * tests can control each stage's outcome directly.
 */
export function createFakePipeline(ports: FakePorts, logger: Logger): Pipeline {
  const scanProjectUseCase = new ScanProjectUseCase(ports.scannerPort, logger);

  return {
    analyzeCodebase: new AnalyzeCodebaseUseCase(scanProjectUseCase, ports.analysisPort, logger),
    generateTests: new GenerateTestsUseCase(ports.generationPort, logger),
    runTests: new RunTestsUseCase(ports.executionPort, logger),
    generateReport: new GenerateReportUseCase(ports.reporterPort, logger),
  };
}

/**
 * Builds a full {@link Composition} (pipeline, standalone
 * `measureCoverage` use case, and logger) wired to caller-supplied fake
 * ports, for tests that construct commands directly against a
 * {@link Composition}.
 */
export function createFakeComposition(ports: FakePorts, logger: Logger): Composition {
  return {
    pipeline: createFakePipeline(ports, logger),
    measureCoverage: new MeasureCoverageUseCase(ports.coveragePort ?? defaultCoveragePort, logger),
    logger,
  };
}
