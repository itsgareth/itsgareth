import fs from "fs/promises";
import ini from "ini";
import { Octokit } from "@octokit/rest";

(async () => {
  const defaults = await fs.readFile("./scripts/update-readme/defaults.ini", "utf-8");
  const configuration = ini.parse(defaults);
  
  const TOKEN = process.env.TOKEN;
  const USERNAME = configuration.authentication.username;
  const CONTENT_WIDTH = 64;
  const CONTENT_PADDING = 5;

  const octokit = new Octokit({ auth: TOKEN });
  const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, { affiliation: "owner", per_page: 100 });
  const current = await octokit.rest.repos.getReadme({ owner: USERNAME, repo: USERNAME });

  const calculateDate = (since) => {
    const start = new Date(since);
    const now = new Date();
    const elapsed = new Date(now - start);
    const year = elapsed.getUTCFullYear() - 1970;
    const month = elapsed.getUTCMonth();
    const day = elapsed.getUTCDate();
    const pluralize = (unit, count) => (count === 1 ? unit : `${count} ${unit}s`);
    return `${pluralize("year", year)}, ${pluralize("month", month)}, ${pluralize("day", day)}`;
  };

  const stats = {
    name: configuration.profile.full_name,
    age: calculateDate(configuration.profile.birth_date),
    location: configuration.profile.location,
    website: configuration.profile.website,
    email: configuration.profile.email_address,
    company: configuration.employment.company,
    role: configuration.employment.job_title,
    joined: `${calculateDate(configuration.employment.start_date)} ago`,
    machine: configuration.development.machine,
    os: configuration.development.operating_system,
    ide: configuration.development.ide,
    terminal: configuration.development.terminal,
    repositories: String(repos.length),
    commits: String(0),
    lines_of_code: String(0),
  };

  const template = await fs.readFile("./scripts/update-readme/template.txt", "utf-8");
  const rendered = template.replace(/{{(.*?)}}/g, (_, key) => {
    const value = stats[key.trim()] ?? "N/A";
    const dots = ".".repeat(Math.max(0, CONTENT_WIDTH - CONTENT_PADDING - key.length - value.length));
    return `${dots} ${value}`;
  });

  await octokit.rest.repos.createOrUpdateFileContents({
    owner: USERNAME,
    repo: USERNAME,
    path: "readme.md",
    message: "chore: update readme via script",
    content: Buffer.from(rendered).toString("base64"),
    sha: current.data.sha,
  });
})();
