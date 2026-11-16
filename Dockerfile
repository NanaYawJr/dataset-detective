# Builds the static site, then serves it with Caddy, beside a small Python
# server that counts usage anonymously. The running container holds the web
# server, the built files and that server: no Node, no source code of the site.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Compress once at build time, so the 35 MB engine isn't re-compressed on every request.
RUN apt-get update \
  && apt-get install -y --no-install-recommends brotli \
  && rm -rf /var/lib/apt/lists/* \
  && find dist -type f \( -name '*.wasm' -o -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) \
     -exec brotli --best --keep {} \; -exec gzip --best --keep {} \;

FROM caddy:2-alpine AS caddy

FROM python:3.13-slim
WORKDIR /app
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
COPY api/app api/app
COPY start.sh /start.sh

# Usage totals are kept here. Mount a volume at /data so they survive a new deployment.
ENV DATA_DIR=/data
CMD ["/bin/bash", "/start.sh"]
