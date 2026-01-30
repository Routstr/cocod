const SOCKET_PATH = process.env.COCOD_SOCKET || "/tmp/cocod.sock";

interface CommandResponse {
  output?: string;
  error?: string;
}

function getEndpoint(command: string): { path: string; method: string } {
  switch (command) {
    case "balance":
      return { path: "/balance", method: "GET" };
    case "help":
      return { path: "/help", method: "GET" };
    case "ping":
      return { path: "/ping", method: "GET" };
    default:
      return { path: `/${command}`, method: "GET" };
  }
}

export async function runCommand(command: string, args: string[]) {
  const { path, method } = getEndpoint(command);

  const response = await fetch(`http://localhost${path}`, {
    unix: SOCKET_PATH,
    method,
  });

  if (!response.ok) {
    const errorData = await response.json() as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<CommandResponse>;
}
