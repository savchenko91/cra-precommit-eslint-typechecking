const { execSync } = require("child_process");

class Manager {
  filesArr = [];

  precommit = false;

  setPrecommit = (b) => {
    this.precommit = b;
  };

  buildRegExp = (regexp) => {
    if (!this.precommit) {
      return regexp;
    }

    const filesBinary = execSync(
      "echo $(git diff --cached --name-only --diff-filter=ACM)"
    );

    this.filesArr = filesBinary
      ?.toString()
      .replace(/(\r\n|\n|\r)/gm, "")
      .split(" ")
      .filter((f) => regexp.test(f));

    return new RegExp(this.filesArr.join("|"));
  };
}

const manager = new Manager();

module.exports = manager;
