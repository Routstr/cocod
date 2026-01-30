import { runCommand, commands, type CommandResponse } from "./ipc";
import { startDaemon } from "./daemon";
import { program } from "commander";

const SOCKET_PATH = process.env.COCOD_SOCKET || "/tmp/cocod.sock";

async function isDaemonRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost/ping`, {
      unix: SOCKET_PATH,
    } as RequestInit);
    return response.ok;
  } catch {
    return false;
  }
}

async function startDaemonProcess(): Promise<void> {
  // Start daemon in background using Bun.spawn
  const proc = Bun.spawn({
    cmd: ["bun", "run", `${import.meta.dir}/index.ts`, "daemon"],
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  proc.unref();

  // Wait for daemon to be ready (max 5 seconds)
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await isDaemonRunning()) {
      return;
    }
  }

  throw new Error("Daemon failed to start within 5 seconds");
}

async function ensureDaemonRunning(): Promise<void> {
  if (await isDaemonRunning()) {
    return;
  }

  console.log("Starting daemon...");
  await startDaemonProcess();
}

async function handleCommand(
  commandName: string,
  args: string[] = []
): Promise<CommandResponse> {
  try {
    await ensureDaemonRunning();
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
      console.error("Daemon is not running and failed to auto-start");
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
