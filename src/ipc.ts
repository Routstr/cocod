const SOCKET_PATH = process.env.COCOD_SOCKET || "/tmp/cocod.sock";

interface CommandResponse {
  output?: string;
  error?: string;
}

export async function runCommand(command: string, args: string[]) {
  const response = await fetch("http://localhost/command", {
    unix: SOCKET_PATH,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args }),
  });

  if (!response.ok) {
    const errorData = await response.json() as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<CommandResponse>;
}
