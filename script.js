#!/usr/bin/env node

"use strict";
// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = "development";
process.env.NODE_ENV = "production";

const { execSync } = require("child_process");
const chalk = require("chalk");
const clearConsole = require("react-dev-utils/clearConsole");
const formatWebpackMessages = require("react-dev-utils/formatWebpackMessages");
const typescriptFormatter = require("react-dev-utils/typescriptFormatter");
const forkTsCheckerWebpackPlugin = require("react-dev-utils/ForkTsCheckerWebpackPlugin");

const manager = require(".");

manager.setPrecommit(true);

const isInteractive = process.stdout.isTTY;
// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on("unhandledRejection", (err) => {
  throw err;
});

// Ensure environment variables are read.

const fs = require("fs");
const webpack = require("webpack");

const paths = require("../../config/paths");

const devSocket = {
  warnings: (warnings) => console.log("warnings", warnings),
  errors: (errors) => console.log("errors", errors),
};

const useTypeScript = fs.existsSync(paths.appTsConfig);

const tscCompileOnError = process.env.TSC_COMPILE_ON_ERROR === "true";

clearConsole();

run();

async function run() {
  const configFactory = require("../../config/webpack.config");
  const config = configFactory("development");

  setTimeout(() => {
    const compiler = createCompiler({
      config,
      devSocket,
      useTypeScript,
      tscCompileOnError,
      webpack,
    });

    compiler.watch(
      {
        aggregateTimeout: 300,
        poll: undefined,
      },
      (err, stats) => {}
    );
  });
}

function createCompiler({
  config,
  devSocket,
  useTypeScript,
  tscCompileOnError,
  webpack,
}) {
  // "Compiler" is a low-level interface to webpack.
  // It lets us listen to some events and provide our own custom messages.
  let compiler;
  try {
    compiler = webpack(config);
  } catch (err) {
    console.log(chalk.red("Failed to compile."));
    console.log();
    console.log(err.message || err);
    console.log();
    process.exit(1);
  }

  // "invalid" event fires when you have changed a file, and webpack is
  // recompiling a bundle. WebpackDevServer takes care to pause serving the
  // bundle, so if you refresh, it'll wait instead of serving the old one.
  // "invalid" is short for "bundle invalidated", it doesn't imply any errors.
  compiler.hooks.invalid.tap("invalid", () => {
    if (isInteractive) {
      clearConsole();
    }
    console.log("Compiling...");
  });

  let tsMessagesPromise;
  let tsMessagesResolver;

  if (useTypeScript) {
    compiler.hooks.beforeCompile.tap("beforeCompile", () => {
      tsMessagesPromise = new Promise((resolve) => {
        tsMessagesResolver = (msgs) => resolve(msgs);
      });
    });

    forkTsCheckerWebpackPlugin
      .getCompilerHooks(compiler)
      .receive.tap("afterTypeScriptCheck", (diagnostics, lints) => {
        const allMsgs = [...diagnostics, ...lints];
        const format = (message) =>
          `${message.file}\n${typescriptFormatter(message, true)}`;

        tsMessagesResolver({
          errors: allMsgs.filter((msg) => msg.severity === "error").map(format),
          warnings: allMsgs
            .filter((msg) => msg.severity === "warning")
            .map(format),
        });
      });
  }

  compiler.hooks.done.tap("done", async (stats) => {
    if (isInteractive) {
      clearConsole();
    }

    // We have switched off the default webpack output in WebpackDevServer
    // options so we are going to "massage" the warnings and errors and present
    // them in a readable focused way.
    // We only construct the warnings and errors for speed:
    // https://github.com/facebook/create-react-app/issues/4492#issuecomment-421959548
    const statsData = stats.toJson({
      all: false,
      warnings: true,
      errors: true,
    });

    if (useTypeScript && statsData.errors.length === 0) {
      const delayedMsg = setTimeout(() => {
        console.log(
          chalk.yellow(
            "Files successfully emitted, waiting for typecheck results..."
          )
        );
      }, 100);

      const messages = await tsMessagesPromise;
      clearTimeout(delayedMsg);
      if (tscCompileOnError) {
        statsData.warnings.push(...messages.errors);
      } else {
        statsData.errors.push(...messages.errors);
      }
      statsData.warnings.push(...messages.warnings);

      // Push errors and warnings into compilation result
      // to show them after page refresh triggered by user.
      if (tscCompileOnError) {
        stats.compilation.warnings.push(...messages.errors);
      } else {
        stats.compilation.errors.push(...messages.errors);
      }
      stats.compilation.warnings.push(...messages.warnings);

      if (messages.errors.length > 0) {
        if (tscCompileOnError) {
          devSocket.warnings(messages.errors);
        } else {
          devSocket.errors(messages.errors);
        }
      } else if (messages.warnings.length > 0) {
        devSocket.warnings(messages.warnings);
      }

      if (isInteractive) {
        clearConsole();
      }
    }

    const messages = formatWebpackMessages(statsData);
    const isSuccessful = !messages.errors.length && !messages.warnings.length;
    if (isSuccessful) {
      console.log(chalk.green("Successfully!"));

      execSync(`git add ${manager.filesArr.join(" ")}`, {
        stdio: "pipe",
      });

      process.exit(0);
    }

    // If errors exist, only show errors.
    if (messages.errors.length) {
      // Only keep the first error. Others are often indicative
      // of the same problem, but confuse the reader with noise.
      if (messages.errors.length > 1) {
        messages.errors.length = 1;
      }
      console.log(chalk.red("Failed to compile.\n"));
      console.log(messages.errors.join("\n\n"));
      return;
    }

    // Show warnings if no errors were found.
    if (messages.warnings.length) {
      console.log(chalk.yellow("Compiled with warnings.\n"));
      console.log(messages.warnings.join("\n\n"));

      // Teach some ESLint tricks.
      console.log(
        "\nSearch for the " +
          chalk.underline(chalk.yellow("keywords")) +
          " to learn more about each warning."
      );
      console.log(
        "To ignore, add " +
          chalk.cyan("// eslint-disable-next-line") +
          " to the line before.\n"
      );
    }
  });

  // You can safely remove this after ejecting.
  // We only use this block for testing of Create React App itself:
  const isSmokeTest = process.argv.some(
    (arg) => arg.indexOf("--smoke-test") > -1
  );
  if (isSmokeTest) {
    compiler.hooks.failed.tap("smokeTest", async () => {
      await tsMessagesPromise;
      process.exit(1);
    });
    compiler.hooks.done.tap("smokeTest", async (stats) => {
      await tsMessagesPromise;
      if (stats.hasErrors() || stats.hasWarnings()) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    });
  }

  return compiler;
}
