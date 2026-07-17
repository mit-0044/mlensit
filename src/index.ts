import { compose } from './composition/compose.js';
import { createProgram } from './create-program.js';

const composition = compose();
const program = createProgram(composition);

program.parseAsync(process.argv).catch((error: unknown) => {
  composition.logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
