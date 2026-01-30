import { runCommand } from "./ipc";

interface CommandResult {
  output?: string;
  error?: string;
}

export async function cli(args: string[]) {
  const command = args[0] || "help";

  try {
    const result = (await runCommand(command, args.slice(1))) as CommandResult;

    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }

    if (result.output) {
      console.log(result.output);
    }
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
