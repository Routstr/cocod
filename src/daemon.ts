import { handlers } from "./commands/index";

const SOCKET_PATH = process.env.COCOD_SOCKET || "/tmp/cocod.sock";

interface CommandRequest {
  command: string;
  args?: string[];
}

export async function startDaemon() {
  try {
    await Bun.file(SOCKET_PATH).delete();
  } catch {
    // File might not exist
  }

  const server = Bun.serve({
    unix: SOCKET_PATH,
    async fetch(req) {
      try {
        const body = await req.json() as CommandRequest;
        const { command, args = [] } = body;

        const handler = handlers[command];
        
        if (!handler) {
          return Response.json({ error: `Unknown command: ${command}` }, { status: 404 });
        }

        const result = await handler(args);
        return Response.json(result);
      } catch (error) {
        return Response.json({ 
          error: error instanceof Error ? error.message : "Unknown error" 
        }, { status: 500 });
      }
    },
  });

  console.log(`Daemon listening on ${SOCKET_PATH}`);
  
  process.on("SIGINT", () => {
    console.log("\nShutting down daemon...");
    server.stop();
    process.exit(0);
  });
}
