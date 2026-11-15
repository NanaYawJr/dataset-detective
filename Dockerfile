# Builds the static site, then serves it with Caddy.
# The running container holds only the web server and the built files.

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

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
