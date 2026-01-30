import { runCommand, commands, type CommandResponse } from "./ipc";
import { startDaemon } from "./daemon";
import { program } from "commander";

async function handleCommand(
  commandName: string,
  args: string[] = []
): Promise<CommandResponse> {
  try {
    const result = await runCommand(commandName, args);

    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }

    if (result.output) {
      console.log(result.output);
    }

    return result;
  } catch (error) {
    const message = (error as Error).message;
    if (
      message?.includes("fetch failed") ||
      message?.includes("Connection refused")
    ) {
      console.error("Daemon is not running. Start it with: cocod daemon");
      process.exit(1);
    }
    throw error;
  }
}

program.name("cocod").description("Coco CLI - A Cashu wallet daemon");

// Auto-generate commands from registry
for (const command of commands) {
  let cmdStr = command.name;
  if (command.args && command.args.length > 0) {
    cmdStr += " " + command.args.map((arg) => `<${arg}>`).join(" ");
  }

  const cmd = program
    .command(cmdStr)
    .description(command.description)
    .action(async (...actionArgs: (string | object)[]) => {
      // Commander passes arguments differently based on whether there are args
      // If command has no args, actionArgs[0] is the command instance (object)
      // If command has args, actionArgs contains the args followed by the command instance
      const actualArgs = command.args
        ? actionArgs.slice(0, command.args.length).map(String)
        : [];
      await handleCommand(command.name, actualArgs);
    });
}

// Daemon command is special (doesn't go through IPC)
program
  .command("daemon")
  .description("Start the background daemon")
  .action(async () => {
    await startDaemon();
  });

export function cli(args: string[]) {
  program.parse(args);
}
