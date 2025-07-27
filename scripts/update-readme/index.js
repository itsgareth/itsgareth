import { Octokit as OctokitREST } from "@octokit/rest";
import { graphql as OctokitGraphQL } from "@octokit/graphql";
import { loadConfiguration, fetchContributions, fetchLinesOfCode, calculateDate, generatePopulatedTemplate, commitPopulatedTemplate } from "./helpers.js";

/**
 * This script fetches dynamic data from the GitHub API—including contributions,
 * commit history, and lines of code. It then populates a template and commits the result
 * back to the user's profile repository as readme.md.
 *
 * ⚠️ This script is not optimized for scalability:
 * - It relies on many sequential API requests, which is extremely slow.
 * - It uses no caching or local persistence, meaning all data is fetched fresh every run.
 * - For large accounts or repositories, execution time and API rate limits may become a bottleneck.
 *
 * 🔮 Future improvements could include:
 * - Caching previous results to avoid redundant GitHub queries.
 * - Batching or parallelizing requests where possible.
 */

(async () => {
  const configuration = await loadConfiguration();
  const TOKEN = process.env.TOKEN;
  let APIRequests = 0;

  const octokitREST = new OctokitREST({ auth: TOKEN });
  const octokitGraphQL = OctokitGraphQL.defaults({ headers: { authorization: `token ${TOKEN}` } });

  const user = await octokitREST.rest.users.getAuthenticated();
  APIRequests++

  const repositories = await octokitREST.paginate(octokitREST.rest.repos.listForAuthenticatedUser, { affiliation: "owner", per_page: 100 });
  APIRequests++

  const { contributions, fetchContributionsAPICallCount } = await fetchContributions(octokitGraphQL, user.data.login, user.data.created_at)
  APIRequests += fetchContributionsAPICallCount

  const { additions, deletions, fetchLinesOfCodeAPICallCount } = await fetchLinesOfCode(octokitREST, user.data.login, user.data.created_at)
  APIRequests += fetchLinesOfCodeAPICallCount

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
    repositories: String(repositories.length),
    contributions: String(contributions),
    lines_of_code: `${additions + deletions} (+${additions} / -${deletions})`,
  };

  const populatedTemplate = await generatePopulatedTemplate(stats);
  const commitPopulatedTemplateAPICallCount = await commitPopulatedTemplate(octokitREST, user.data.login, populatedTemplate);
  APIRequests += commitPopulatedTemplateAPICallCount

  console.log(`📦 Total API requests: ${APIRequests}`)
})()
