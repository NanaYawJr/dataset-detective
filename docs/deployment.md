# Deployment

Dataset Detective is a static site: HTML, JavaScript, fonts and the DuckDB engine. It is built into a small container and served by [Caddy](https://caddyserver.com). There is no application server and no database.

| File            | What it does                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `Dockerfile`    | Stage 1 builds the site with Node and compresses the files. Stage 2 is Caddy plus the built files only.   |
| `Caddyfile`     | Serves the files with the security headers, caching rules and pre-compressed copies. Keeps no access log. |
| `railway.json`  | Tells Railway to build from the Dockerfile and to health-check the home page.                             |
| `.dockerignore` | Keeps tests, docs and local files out of the build.                                                       |

See [decision 0007](decisions/0007-static-site-in-a-container.md) for why it is hosted this way.

## Deploying on Railway

1. In Railway, choose **New Project → Deploy from GitHub repo** and pick `dataset-detective`. Railway finds the Dockerfile and builds it.
2. In the service's **Variables**, add `PORT` = `8080`, so the port is fixed and known.
3. In **Settings → Networking**, choose **Generate Domain** (enter port `8080` if asked). Open the address and profile the sample file to check it works.
4. Still in **Networking**, choose **Custom Domain** and enter the address you want, for example `detective.example.com`. Railway shows the DNS records to add.
5. At your domain registrar, add those records. Usually this is one `CNAME` record whose name is the subdomain (`detective`) and whose value is the address Railway shows; Railway may also ask for a `TXT` record to prove ownership.
6. Wait for Railway to show the domain as verified (minutes, sometimes up to an hour). HTTPS is set up automatically.

Every push to `main` builds and publishes a new version. To avoid publishing a broken build, turn on **Wait for CI** in the service settings so Railway deploys only after the GitHub checks pass.

## Checking a deployment

```bash
curl -sI https://detective.example.com/ | grep -iE 'content-security-policy|strict-transport|x-frame|referrer|cache-control'
```

The response should include the Content Security Policy with `connect-src 'self'` and `frame-ancestors 'none'`. A unit test (`src/lib/deployPolicy.test.ts`) fails if the policy in `Caddyfile` and the one in `vite.config.ts` ever differ.

## Running the container locally

```bash
docker build -t dataset-detective .
docker run --rm -p 8080:8080 dataset-detective
```

Then open http://localhost:8080.
