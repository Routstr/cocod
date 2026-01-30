#!/usr/bin/env bun
import { cli } from "./cli";
import { startDaemon } from "./daemon";

const args = process.argv.slice(2);
const command = args[0];

if (command === "daemon") {
  startDaemon();
} else {
  cli(args);
}
