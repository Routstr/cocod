import { program } from "commander";

const CONFIG_DIR = `${process.env.HOME || process.env.USERPROFILE}/.cocod`;
const SOCKET_PATH = process.env.COCOD_SOCKET || `${CONFIG_DIR}/cocod.sock`;

export interface CommandResponse {
  output?: string;
  error?: string;
}

async function callDaemon(
  path: string,
  options: { method?: "GET" | "POST"; body?: object } = {}
): Promise<CommandResponse> {
  const { method = "GET", body } = options;

  const init: RequestInit & { unix: string } = {
    unix: SOCKET_PATH,
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  } as RequestInit & { unix: string };

  const response = await fetch(`http://localhost${path}`, init);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<CommandResponse>;
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost/ping`, {
      unix: SOCKET_PATH,
    } as RequestInit);
    return response.ok;
  } catch {
    return false;
  }
}

export async function startDaemonProcess(): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", `${import.meta.dir}/index.ts`, "daemon"],
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  proc.unref();

  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await isDaemonRunning()) {
      return;
    }
  }

  throw new Error("Daemon failed to start within 5 seconds");
}

export async function ensureDaemonRunning(): Promise<void> {
  if (await isDaemonRunning()) {
    return;
  }

  console.log("Starting daemon...");
  await startDaemonProcess();
}

export async function handleDaemonCommand(
  path: string,
  options: { method?: "GET" | "POST"; body?: object } = {}
): Promise<CommandResponse> {
  try {
    await ensureDaemonRunning();
    const result = await callDaemon(path, options);

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

export { program, callDaemon };
