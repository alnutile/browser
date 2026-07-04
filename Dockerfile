# Playwright's official image ships Chromium plus every system library it needs.
# This tag MUST match the exact "playwright" version in package.json — the image's
# bundled browser and the npm package's expected browser build are version-locked.
# If you bump one, bump the other.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Build the TypeScript.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the final image.
RUN npm prune --omit=dev

ENV NODE_ENV=production
# DATA_DIR should point at a mounted Railway Volume (see README).
ENV DATA_DIR=/data

# Railway sets PORT at runtime; EXPOSE is documentation only.
EXPOSE 3000

CMD ["node", "dist/server.js"]
