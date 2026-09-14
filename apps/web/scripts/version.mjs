import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const workspaceDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const webPackageJsonPath = resolve(workspaceDir, "apps/web/package.json");
const packageJsonPaths = [
  resolve(workspaceDir, "package.json"),
  webPackageJsonPath,
  resolve(workspaceDir, "apps/landing/package.json")
];
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

async function readPackageJson(packageJsonPath) {
  const contents = await readFile(packageJsonPath, "utf8");
  return JSON.parse(contents);
}

async function writePackageJson(packageJsonPath, packageJson) {
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function parseVersion(version) {
  const match = semverPattern.exec(version);
  if (!match) {
    throw new Error(`Invalid SemVer version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function incrementVersion(version, part) {
  const parsed = parseVersion(version);

  if (part === "major") {
    return `${parsed.major + 1}.0.0`;
  }

  if (part === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  if (part === "patch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }

  throw new Error(`Unknown version part: ${part}`);
}

async function setVersion(nextVersion) {
  parseVersion(nextVersion);

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = await readPackageJson(packageJsonPath);
    const previousVersion = packageJson.version ?? "(none)";
    packageJson.version = nextVersion;
    await writePackageJson(packageJsonPath, packageJson);

    console.log(`${packageJson.name}: ${previousVersion} -> ${nextVersion}`);
  }
}

async function main() {
  const [command, value] = process.argv.slice(2);
  const packageJson = await readPackageJson(webPackageJsonPath);

  if (command === "show" || !command) {
    console.log(packageJson.version);
    return;
  }

  if (command === "set") {
    if (!value) {
      throw new Error("Usage: pnpm run version:set <major.minor.patch>");
    }

    await setVersion(value);
    return;
  }

  if (["major", "minor", "patch"].includes(command)) {
    await setVersion(incrementVersion(packageJson.version, command));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
