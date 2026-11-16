# Deployment

The live site is at [detective.michaelopokukwarteng.com](https://detective.michaelopokukwarteng.com).

Dataset Detective is a static site: HTML, JavaScript, fonts and the DuckDB engine. It is built into a small container and served by [Caddy](https://caddyserver.com). Beside it, in the same container, a small Python server counts usage anonymously and serves the private usage page; Caddy passes it only the requests under `/api/`.

| File            | What it does                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `Dockerfile`    | Stage 1 builds the site with Node and compresses the files. Stage 2 is Caddy plus the built files only.   |
| `Caddyfile`     | Serves the files with the security headers, caching rules and pre-compressed copies. Keeps no access log. |
| `api/`          | The counting server (FastAPI). Listens only inside the container.                                         |
| `start.sh`      | Starts the counting server and Caddy together.                                                            |
| `railway.json`  | Tells Railway to build from the Dockerfile and to health-check the home page.                             |
| `.dockerignore` | Keeps tests, docs and local files out of the build.                                                       |

See [decision 0007](decisions/0007-static-site-in-a-container.md) for why it is hosted this way.

## Deploying on Railway

The site is published by the GitHub workflow, not by linking the repository to Railway. After the checks and browser tests pass on `main`, the `deploy` job in `.github/workflows/ci.yml` sends the code to Railway, which builds the Dockerfile. This works when the Railway account and the GitHub repository belong to different owners, and nothing is published unless the tests pass.

### One-off setup

1. In Railway, choose **New Project → Empty Project**, then **Create → Empty Service**. Name the service `dataset-detective` (the workflow publishes to a service with this name).
2. In the service's **Variables**, add `PORT` = `8080`, so the port is fixed and known.
3. In the project's **Settings → Tokens**, create a project token for the `production` environment and copy it.
4. In the GitHub repository, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `RAILWAY_TOKEN` and paste the token.
5. Push to `main` (or re-run the latest workflow from the **Actions** tab). When the `Publish to Railway` job is green, the service is built and running.
6. In the service's **Settings → Networking**, choose **Generate Domain** (enter port `8080` if asked). Open the address and profile the sample file to check it works.

Until the secret exists, the `deploy` job does nothing and stays green.

### Usage counts and the private usage page

1. **Keep the counts between deployments.** In the service, add a **Volume** and mount it at `/data`. Without it the totals start again from zero on every deployment.
2. **Set the password.** In the service's **Variables**, add `STATS_PASSWORD` with a long, random value. Without it the usage page stays switched off.
3. Open `https://your-address/#stats` and enter the password.

The page shows, per day: visits, distinct visitors, files profiled (by format) and distinct people who profiled a file. What is and isn't recorded is set out in [PRIVACY.md](../PRIVACY.md) and [decision 0009](decisions/0009-anonymous-usage-counts.md).

To check that visitors are being told apart, open the site on two different networks (for example a laptop on Wi-Fi and a phone on mobile data): the day's visitors should go up by two.

### Custom domain

1. In **Settings → Networking**, choose **Custom Domain** and enter the address you want, for example `detective.example.com`. Railway shows the DNS records to add.
2. At your domain registrar, add those records. Usually this is one `CNAME` record whose name is the subdomain (`detective`) and whose value is the address Railway shows; Railway may also ask for a `TXT` record to prove ownership.
3. Wait for Railway to show the domain as verified (minutes, sometimes up to an hour). HTTPS is set up automatically.

### The token

The project token can only deploy to this one Railway project. It is stored as an encrypted GitHub secret, is never printed in logs, and is not available to workflows started from forks. If it is ever exposed, delete it in Railway and create a new one.

## Checking a deployment

```bash
curl -sI https://detective.example.com/ | grep -iE 'content-security-policy|strict-transport|x-frame|referrer|cache-control'
```

The response should include the Content Security Policy with `connect-src 'self'` and `frame-ancestors 'none'`. A unit test (`src/lib/deployPolicy.test.ts`) fails if the policy in `Caddyfile` and the one in `vite.config.ts` ever differ.

## Running the container locally

```bash
docker build -t dataset-detective .
docker run --rm -p 8080:8080 -e STATS_PASSWORD=change-me -v detective-data:/data dataset-detective
```

Then open http://localhost:8080.
