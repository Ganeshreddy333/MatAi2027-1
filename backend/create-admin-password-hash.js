"use strict";

const { hashAdminPassword } = require("./admin-auth");

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  console.error("Run this command in an interactive terminal so the password is not echoed.");
  process.exit(1);
}

process.stdout.write("New admin password (minimum 12 characters): ");
process.stdin.setRawMode(true);
process.stdin.resume();

let password = "";
function finish() {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\n");
  try {
    process.stdout.write(hashAdminPassword(password) + "\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    password = "";
  }
}

process.stdin.on("data", (chunk) => {
  for (const character of chunk.toString("utf8")) {
    if (character === "\u0003") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\nCancelled.\n");
      password = "";
      process.exitCode = 1;
      return;
    }
    if (character === "\r" || character === "\n") {
      finish();
      return;
    }
    if (character === "\u007f" || character === "\b") {
      password = password.slice(0, -1);
      continue;
    }
    if (character >= " ") password += character;
  }
});
