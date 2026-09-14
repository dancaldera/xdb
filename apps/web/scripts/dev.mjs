import { spawn } from "node:child_process";
import { resolve } from "node:path";

const workspaceDir = resolve(import.meta.dirname, "..");

function run(name, command, args, color) {
  const child = spawn(command, args, {
    cwd: workspaceDir,
    env: process.env,
    shell: process.platform === "win32"
  });

  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  const forward = (stream, out) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        out.write(`${prefix} ${line}\n`);
      }
    });
    stream.on("end", () => {
      if (buffer) {
        out.write(`${prefix} ${buffer}\n`);
      }
    });
  };

  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code ?? 0}`);
  });

  return child;
}

const processes = [
  run("server", "pnpm", ["exec", "tsx", "watch", "src/server/index.ts"], "36"),
  run("web", "pnpm", ["exec", "vite"], "33")
];

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of processes) {
      child.kill(signal);
    }
  });
}
