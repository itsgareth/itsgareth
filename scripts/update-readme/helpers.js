import fs from "fs/promises";
import ini from "ini";
import { intervalToDuration, isBefore } from "date-fns";

/**
 * Loads and parses the configuration from the defaults.ini file.
 *
 * This function reads the defaults.ini file located in the ./scripts/update-readme/
 * directory and parses its contents into a JavaScript object using the ini module.
 */
export const loadConfiguration = async () => {
  console.log("🔧 Loading configuration");

  const defaults = await fs.readFile("./scripts/update-readme/defaults.ini", "utf-8");
  const configuration = ini.parse(defaults);

  console.log("✨ Configuration loaded" + "\n");
  return configuration;
}

/**
 * Fetches the total number of contributions (commits, PRs, issues, etc.)
 * made by the user since a given date, using the GitHub GraphQL API.
 *
 * To ensure complete coverage and avoid GraphQL API limits,
 * the query is chunked into yearly intervals starting from the given date.
 *
 * For each year, it fetches the total number of contributions using the
 * contributionsCollection field. The totals are aggregated across all date ranges.
 */
export const fetchContributions = async (octokit, username, since) => {
  console.log("📊 Searching for contributions");

  const creationDate = new Date(since);
  const creationYear = creationDate.getFullYear();
  const yearlyDateRanges = calculateDateRanges("year", creationYear, 0);
  let fetchContributionsAPICallCount = 0;
  let contributions = 0;
  const query = `
    query($login: String!, $start: DateTime!, $end: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $start, to: $end) {
          contributionCalendar {
            totalContributions
          }
        }
      }
    }
  `;

  for (const date of yearlyDateRanges) {
    const response = await octokit(query, { login: username, start: date.from, end: date.to });
    contributions += response.user.contributionsCollection.contributionCalendar.totalContributions;
    fetchContributionsAPICallCount++
  }

  console.log(`📈 Found ${contributions} total contributions` + "\n");
  return { contributions, fetchContributionsAPICallCount }
}

/**
 * Fetches the total number of lines of code added and deleted by the user
 * since a given date, using GitHub's search API.
 *
 * To avoid GitHub's 1000-result cap on the search API, this function
 * divides the request into monthly chunks and aggregates the results.
 *
 * For each month, it searches for commits authored by the user. It then
 * fetches detailed stats (additions and deletions) for each commit.
 * There is a delay of 2 seconds between each API call to avoid rate limits.
 */
export const fetchLinesOfCode = async (octokit, username, since) => {
  console.log("🧮 Analyzing lines of code...");

  const startDate = new Date(since);
  const startMonth = startDate.getMonth();
  const startYear = startDate.getFullYear();
  const monthlyDateRanges = calculateDateRanges("month", startYear, startMonth);
  let additions = 0;
  let deletions = 0;
  let fetchLinesOfCodeAPICallCount = 0;

  for (const date of monthlyDateRanges) {
    const query = `author:${username} committer-date:${date.from}..${date.to}`;
    const commits = await octokit.paginate(octokit.rest.search.commits, { q: query, per_page: 100 });
    fetchLinesOfCodeAPICallCount++

    for (const commit of commits) {
      const fullCommit = await octokit.request(`GET ${commit.url}`);
      additions += fullCommit.data.stats.additions;
      deletions += fullCommit.data.stats.deletions;
      fetchLinesOfCodeAPICallCount++
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`📉 Found ${additions + deletions} lines of code (+${additions} / -${deletions})` + "\n");
  return { additions, deletions, fetchLinesOfCodeAPICallCount }
};

/**
 * Populates the template file by replacing all placeholders with actual values.
 *
 * This function reads the template.txt file that contains placeholders
 * in the {{key}} format. Each placeholder is replaced with its corresponding
 * value from the provided stats object. It also adds dot padding between
 * the key and value to align the content aesthetically.
 */
export const generatePopulatedTemplate = async (stats) => {
  const template = await fs.readFile("./scripts/update-readme/template.txt", "utf-8");
  const populatedTemplate = template.replace(/{{(.*?)}}/g, (_, key) => {
    const value = stats[key.trim()] ?? "N/A";
    const dots = ".".repeat(Math.max(0, 64 - 5 - key.length - value.length));
    return `${dots} ${value}`;
  });
  return populatedTemplate;
}

/**
 * Commits the populated readme template to the users home repository.
 *
 * This function retrieves the current readme.md file from the user's GitHub repository
 * to obtain its SHA (required for updates), then overwrites the file with new content
 * generated from the template.
 */
export const commitPopulatedTemplate = async (octokit, username, populatedTemplate) => {
  console.log("📦 Committing populated template to GitHub");
  let commitPopulatedTemplateAPICallCount = 0;

  const { data: { sha: readmeSha } } = await octokit.rest.repos.getReadme({ owner: username, repo: username });
  commitPopulatedTemplateAPICallCount++;

  await octokit.rest.repos.createOrUpdateFileContents({
    owner: username,
    repo: username,
    path: "readme.md",
    message: "chore: update generated content",
    content: Buffer.from(populatedTemplate).toString("base64"),
    sha: readmeSha,
  });
  commitPopulatedTemplateAPICallCount++;

  console.log("✅ Populated template committed successfully" + "\n");
  return commitPopulatedTemplateAPICallCount;
};

/**
 * Calculates the time elapsed between a given start date and the current date.
 *
 * This function returns a human-readable string representing the duration
 * in the format: "X years, Y months, Z days". It uses date-fns to handle
 * leap years, month boundaries, and calendar logic safely.
 */
export const calculateDate = (since) => {
  const { years, months, days } = intervalToDuration({ start: new Date(since), end: new Date() });
  const pluralize = (unit, value) => (value === 1 ? `1 ${unit}` : `${value} ${unit}s`);
  return `${pluralize("year", years)}, ${pluralize("month", months)}, ${pluralize("day", days)}`;
};

/**
 * Calculates an array of date range objects spanning from a given starting
 * year and month up to the current date, divided into uniform chunks.
 *
 * This is used for paginating long time intervals in API calls, such as when
 * working with GitHub's APIs that enforce strict result limits.
 */
export const calculateDateRanges = (chunk, fromYear, fromMonth) => {
  const now = new Date();
  const ranges = [];

  if (chunk === "month") {
    let current = new Date(Date.UTC(fromYear, fromMonth, 1));
    while (isBefore(current, now)) {
      const next = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
      ranges.push({ from: current.toISOString(), to: next.toISOString() });
      current = next;
    }
  }

  if (chunk === "year") {
    let current = new Date(Date.UTC(fromYear, 0, 1));
    while (isBefore(current, now)) {
      const next = new Date(Date.UTC(current.getUTCFullYear() + 1, 0, 1));
      ranges.push({ from: current.toISOString(), to: next.toISOString() });
      current = next;
    }
  }

  return ranges;
};
