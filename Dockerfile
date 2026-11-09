FROM node:26-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init
WORKDIR /usr
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci --fund=false
COPY src ./src
RUN npm run build
RUN npm prune --omit "dev"

FROM node:26-slim
ARG VERSION
ENV npm_package_version=${VERSION}
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fontconfig \
        fonts-liberation \
        fonts-dejavu \
        ttf-bitstream-vera \
        texlive-fonts-recommended \
        gsfonts \
        gsfonts-x11 \
        fonts-roboto \
        fonts-noto \
        fonts-linuxlibertine\
        fonts-inconsolata \
        fonts-cantarell \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
        fonts-comic-neue \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
# the fonts named by the SVGs of the site and not installed: the closest free ones
COPY fonts/local.conf /etc/fonts/local.conf
COPY --from=build /usr/bin/dumb-init /usr/bin/dumb-init
WORKDIR /usr/bin/app
COPY --from=build --chown=node:node /usr/package.json ./
COPY --from=build --chown=node:node /usr/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/dist ./
ENV NODE_ENV=production
ENV DEBUG="c2c_images:*"
ENV SERVICE_PORT=8080
ENV METRICS_PORT=8081
EXPOSE 8080 8081
USER node
# no curl in the slim image: Node checks the health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:' + process.env.SERVICE_PORT + '/ping').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["dumb-init", "node", "server.js"]
