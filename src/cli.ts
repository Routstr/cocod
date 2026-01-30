import { startDaemon } from "./daemon";
import {
  program,
  handleDaemonCommand,
} from "./cli-shared";

program.name("cocod").description("Coco CLI - A Cashu wallet daemon");

// Balance - simple GET command
program
  .command("balance")
  .description("Get wallet balance")
  .action(async () => {
    await handleDaemonCommand("/balance");
  });

// Receive - POST command with argument
program
  .command("receive <token>")
  .description("Receive Cashu token")
  .action(async (token: string) => {
    await handleDaemonCommand("/receive", {
      method: "POST",
      body: { token },
    });
  });

// Ping
program
  .command("ping")
  .description("Test connection to the daemon")
  .action(async () => {
    await handleDaemonCommand("/ping");
  });

// Stop
program
  .command("stop")
  .description("Stop the background daemon")
  .action(async () => {
    await handleDaemonCommand("/stop", { method: "POST" });
  });

// Mint - nested subcommands
const mintCmd = program
  .command("mint")
  .description("Mint operations");

mintCmd
  .command("add <url>")
  .description("Add a mint URL")
  .action(async (url: string) => {
    await handleDaemonCommand("/mint/add", {
      method: "POST",
      body: { url },
    });
  });

mintCmd
  .command("list")
  .description("List configured mints")
  .action(async () => {
    await handleDaemonCommand("/mint/list");
  });

mintCmd
  .command("bolt11 <amount>")
  .description("Create Lightning invoice to mint tokens")
  .action(async (amount: string) => {
    await handleDaemonCommand("/mint/bolt11", {
      method: "POST",
      body: { amount: parseInt(amount) },
    });
  });

// Daemon command - special case, doesn't go through IPC
program
  .command("daemon")
  .description("Start the background daemon")
  .action(async () => {
    await startDaemon();
  });

export function cli(args: string[]) {
  program.parse(args);
}
