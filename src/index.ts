/**
 * cc-sanitizer — Clean thinking blocks from Claude Code sessions.
 *
 * Fixes the cross-model compatibility issue where third-party model
 * thinking blocks (with invalid/missing Anthropic signatures) cause
 * 400 errors when switching back to official Anthropic models.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import {
  stripFile,
  stripProject,
  scanFile,
  scanProject,
  restoreFile,
  restoreProject,
  listProjects,
  getProjectsDir,
  resolveTarget,
} from "./sanitizer.js";
import type { StripOptions, StripResult, ScanResult, RestoreResult } from "./types.js";

const program = new Command();

program
  .name("cc-sanitizer")
  .description("Clean thinking blocks from Claude Code sessions")
  .version("0.1.0");

// ── strip ────────────────────────────────────────────────────────────────────

program
  .command("strip")
  .description("Remove thinking blocks from a session file or project")
  .argument("[path]", "Session file (.jsonl) or project directory")
  .option("-n, --dry-run", "Preview changes without modifying files", false)
  .option("-b, --backup", "Create .bak backup before modifying", true)
  .option(
    "-s, --suspect-only",
    "Only remove blocks without a valid Anthropic signature",
    false
  )
  .option("-p, --project", "Treat path as a project directory (strip all sessions)", false)
  .action(async (path: string | undefined, opts: StripOptions & { project: boolean }) => {
    if (!path) {
      await printProjectList("strip");
      return;
    }

    const target = await resolveOrExit(path);
    const s = await stat(target);

    const stripOpts: StripOptions = {
      suspectOnly: opts.suspectOnly,
      dryRun: opts.dryRun,
      backup: opts.backup,
    };

    if (s.isDirectory() || opts.project) {
      const spinner = ora("Scanning project sessions...").start();
      const results = await stripProject(target, stripOpts);
      spinner.stop();
      printStripResults(results);
    } else {
      const spinner = opts.dryRun
        ? ora("Analyzing...").start()
        : ora("Stripping thinking blocks...").start();
      const result = await stripFile(target, stripOpts);
      spinner.stop();
      printStripResults([result]);
    }
  });

// ── scan ─────────────────────────────────────────────────────────────────────

program
  .command("scan")
  .description("Scan sessions for third-party thinking blocks")
  .argument("[path]", "Session file (.jsonl) or project directory")
  .option("-p, --project", "Treat path as a project directory (scan all sessions)", false)
  .action(async (path: string | undefined, opts: { project: boolean }) => {
    if (!path) {
      const projects = await listProjects();
      if (projects.length === 0) {
        console.log(chalk.yellow("No projects found in"), getProjectsDir());
        return;
      }
      console.log(chalk.bold("Scanning all projects...\n"));
      const spinner = ora().start();
      const allResults: ScanResult[] = [];
      for (const p of projects) {
        spinner.text = `Scanning ${basename(p)}...`;
        allResults.push(...(await scanProject(p)));
      }
      spinner.stop();
      printScanResults(allResults);
      return;
    }

    const target = await resolveOrExit(path);
    const s = await stat(target);

    const spinner = ora("Scanning...").start();
    let results: ScanResult[];
    if (s.isDirectory() || opts.project) {
      results = await scanProject(target);
    } else {
      results = [await scanFile(target)];
    }
    spinner.stop();
    printScanResults(results);
  });

// ── restore ──────────────────────────────────────────────────────────────────

program
  .command("restore")
  .description("Restore session files from .bak backups")
  .argument("[path]", "Session file (.jsonl) or project directory")
  .option("-p, --project", "Treat path as a project directory (restore all backups)", false)
  .action(async (path: string | undefined, opts: { project: boolean }) => {
    if (!path) {
      await printProjectList("restore");
      return;
    }

    const target = await resolveOrExit(path);
    const s = await stat(target);

    let results: RestoreResult[];
    if (s.isDirectory() || opts.project) {
      const spinner = ora("Restoring from backups...").start();
      results = await restoreProject(target);
      spinner.stop();
    } else {
      const spinner = ora("Restoring from backup...").start();
      results = [await restoreFile(target)];
      spinner.stop();
    }

    let restored = 0;
    for (const r of results) {
      if (r.restored) {
        console.log(chalk.green(`  ✓ ${basename(r.file)} restored`));
        restored++;
      } else {
        console.log(chalk.dim(`  ${basename(r.file)}: ${r.reason}`));
      }
    }

    if (restored === 0) {
      console.log(chalk.yellow("\nNo backups found to restore."));
    } else {
      console.log(chalk.bold(`\nRestored ${restored} session(s) from backup.`));
    }
  });

// ── Target resolution ────────────────────────────────────────────────────────

/**
 * Resolve a target argument to an existing path, or print an error and exit.
 */
async function resolveOrExit(path: string): Promise<string> {
  const target = await resolveTarget(path);
  if (!target) {
    console.error(chalk.red(`Path not found: ${path}`));
    console.error(
      chalk.dim(`Searched the current directory and ${getProjectsDir()}`)
    );
    process.exit(1);
  }
  return target;
}

/**
 * List available projects with a usage hint (shown when no target is given).
 */
async function printProjectList(command: string): Promise<void> {
  const projects = await listProjects();
  if (projects.length === 0) {
    console.log(chalk.yellow("No projects found in"), getProjectsDir());
    return;
  }
  console.log(chalk.bold("Available projects:\n"));
  for (const p of projects) {
    console.log(`  ${chalk.cyan(basename(p))}  ${chalk.dim(p)}`);
  }
  console.log(
    chalk.dim(`\nUsage: cc-sanitizer ${command} <project|session|path> [--project]`)
  );
}

/**
 * Claude Code project directories are named after the encoded working
 * directory, so they begin with "-" (the leading "/" of an absolute path).
 * Commander would treat such a token as an option, so rewrite any argument
 * that names an existing project directory to its absolute path before
 * parsing — letting `cc-sanitizer strip -Users-me-proj --project` work.
 */
function normalizeArgv(argv: string[]): string[] {
  const projectsDir = getProjectsDir();
  return argv.map((arg, i) => {
    if (i < 2) return arg; // node + script
    if (!arg.startsWith("-") || arg.startsWith("--")) return arg;
    const candidate = join(projectsDir, arg);
    return existsSync(candidate) ? candidate : arg;
  });
}

// ── Output helpers ───────────────────────────────────────────────────────────

function printStripResults(results: StripResult[]): void {
  let totalThinking = 0;
  let totalRedacted = 0;
  let anyModified = false;

  const hasProject = results.some(r => r.project);
  let lastProject: string | undefined;

  for (const r of results) {
    if (hasProject && r.project && r.project !== lastProject) {
      console.log(chalk.bold(`\n  ${r.project}/`));
      lastProject = r.project;
    }

    const removed = r.thinkingRemoved + r.redactedRemoved;
    totalThinking += r.thinkingRemoved;
    totalRedacted += r.redactedRemoved;

    if (removed === 0) {
      console.log(chalk.dim(`    ${basename(r.file)}: clean`));
      continue;
    }

    anyModified = true;
    const parts: string[] = [];
    if (r.thinkingRemoved > 0)
      parts.push(chalk.yellow(`${r.thinkingRemoved} thinking`));
    if (r.redactedRemoved > 0)
      parts.push(chalk.yellow(`${r.redactedRemoved} redacted`));
    if (r.eventsRemoved > 0)
      parts.push(chalk.red(`${r.eventsRemoved} empty events`));

    const status = r.dryRun
      ? chalk.blue("(dry-run)")
      : r.backedUp
        ? chalk.green("(backed up)")
        : "";
    console.log(`    ${chalk.cyan(basename(r.file))}: removed ${parts.join(", ")} ${status}`);
  }

  if (!anyModified && results.length > 0) {
    console.log(chalk.green("\n✓ All sessions are clean — nothing to strip."));
  } else if (anyModified) {
    const action = results[0]?.dryRun ? "Would strip" : "Stripped";
    console.log(
      chalk.bold(
        `\n${action} ${totalThinking} thinking + ${totalRedacted} redacted blocks across ${results.length} session(s).`
      )
    );
    if (results[0]?.dryRun) {
      console.log(chalk.dim("Run without --dry-run to apply."));
    }
  }
}

function printScanResults(results: ScanResult[]): void {
  let totalSuspect = 0;
  let hasSuspect = false;

  const hasProject = results.some(r => r.project);
  let lastProject: string | undefined;

  for (const r of results) {
    if (hasProject && r.project && r.project !== lastProject) {
      console.log(chalk.bold(`\n  ${r.project}/`));
      lastProject = r.project;
    }

    totalSuspect += r.suspectBlocks;
    if (r.thinkingBlocks + r.redactedBlocks === 0) {
      console.log(chalk.dim(`    ${basename(r.file)}: no thinking blocks`));
      continue;
    }

    hasSuspect = true;
    const parts: string[] = [];
    if (r.thinkingBlocks > 0)
      parts.push(`${r.thinkingBlocks} thinking`);
    if (r.redactedBlocks > 0)
      parts.push(`${r.redactedBlocks} redacted`);
    if (r.validSignature > 0)
      parts.push(chalk.green(`${r.validSignature} valid sig`));
    if (r.suspectBlocks > 0)
      parts.push(chalk.red(`${r.suspectBlocks} suspect`));

    console.log(`    ${chalk.cyan(basename(r.file))}: ${parts.join(", ")}`);
  }

  if (!hasSuspect && results.length > 0) {
    console.log(chalk.green("\n✓ No suspect thinking blocks found."));
  } else if (totalSuspect > 0) {
    console.log(
      chalk.bold(
        `\nFound ${chalk.red(`${totalSuspect} suspect`)} blocks. Run ${chalk.cyan("cc-sanitizer strip")} to clean them.`
      )
    );
  }
}

program.parse(normalizeArgv(process.argv));
