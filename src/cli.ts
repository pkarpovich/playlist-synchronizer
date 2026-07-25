import { runMappingCommand } from './cli/mapping-command.js';
import { ConfigService, DbService, LogService } from './services.js';
import { Config, IConfig } from './config.js';

const dbService = new DbService(
    new ConfigService<IConfig>(Config),
    new LogService(),
);

const { output, exitCode } = runMappingCommand(
    process.argv.slice(2),
    dbService,
    () => Date.now(),
);

process.stdout.write(`${output.join('\n')}\n`);
process.exit(exitCode);
