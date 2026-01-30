export type CommandHandler = (args: string[]) => Promise<{ output?: string; error?: string }>;

export const handlers: Record<string, CommandHandler> = {
  help: async () => ({
    output: "Available commands:\n  help - Show this help\n  ping - Test connection",
  }),
  ping: async () => ({
    output: "pong",
  }),
};
