import {
  AnalyzeCodebaseUseCase,
  GenerateReportUseCase,
  GenerateTestsUseCase,
  MeasureCoverageUseCase,
  RunTestsUseCase,
} from '@mlensit/core';
import { describe, expect, it } from 'vitest';
import { compose } from './compose.js';

describe('compose', () => {
  it('wires a pipeline with all four use cases', () => {
    const { pipeline } = compose();

    expect(pipeline.analyzeCodebase).toBeInstanceOf(AnalyzeCodebaseUseCase);
    expect(pipeline.generateTests).toBeInstanceOf(GenerateTestsUseCase);
    expect(pipeline.runTests).toBeInstanceOf(RunTestsUseCase);
    expect(pipeline.generateReport).toBeInstanceOf(GenerateReportUseCase);
  });

  it('wires a standalone measureCoverage use case', () => {
    const { measureCoverage } = compose();

    expect(measureCoverage).toBeInstanceOf(MeasureCoverageUseCase);
  });

  it('provides a logger', () => {
    const { logger } = compose();

    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});
