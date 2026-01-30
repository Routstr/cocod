export interface CommandDefinition {
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  args?: string[];
  buildBody?: (args: string[]) => object;
}

export const commands: CommandDefinition[] = [
  {
    name: "stop",
    description: "Stop the background daemon",
    method: "POST",
    path: "/stop",
  },
  {
    name: "ping",
    description: "Test connection to the daemon",
    method: "GET",
    path: "/ping",
  },
  {
    name: "balance",
    description: "Get wallet balance",
    method: "GET",
    path: "/balance",
  },
  {
    name: "receive",
    description: "Receive Cashu token",
    method: "POST",
    path: "/receive",
    args: ["token"],
    buildBody: (args) => ({ token: args[0] }),
  },
];

export function getCommand(name: string): CommandDefinition | undefined {
  return commands.find((c) => c.name === name);
}
