# Editools — single-container deploy (Fastify serves API + built web app)
FROM node:22-slim

# python3 is required by the yt-dlp release binary on Linux
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Also downloads the yt-dlp and ffmpeg binaries (postinstall)
RUN npm ci

COPY . .
RUN npm run build -w @editools/web

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    TRUST_PROXY=1 \
    WEB_DIST=/app/apps/web/dist \
    MAX_FILESIZE=2G

EXPOSE 3001

CMD ["npm", "run", "start", "-w", "@editools/server"]
