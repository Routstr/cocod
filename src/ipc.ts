import { commands, getCommand, type CommandDefinition } from "./commands";

const SOCKET_PATH = process.env.COCOD_SOCKET || "/tmp/cocod.sock";

export interface CommandResponse {
  output?: string;
  error?: string;
}

function buildRequestInit(
  command: CommandDefinition,
  args: string[]
): RequestInit & { unix: string } {
  const headers: Record<string, string> = {};
  let body: string | undefined;

  if (command.method === "POST" && command.buildBody) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(command.buildBody(args));
  }

  return {
    unix: SOCKET_PATH,
    method: command.method,
    headers,
    body,
  } as RequestInit & { unix: string };
}

export async function runCommand(
  commandName: string,
  args: string[]
): Promise<CommandResponse> {
  const command = getCommand(commandName);

  if (!command) {
    throw new Error(`Unknown command: ${commandName}`);
  }

  const fetchOptions = buildRequestInit(command, args);
  const response = await fetch(
    `http://localhost${command.path}`,
    fetchOptions
  );

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<CommandResponse>;
}

export { commands, getCommand };
export type { CommandDefinition };
