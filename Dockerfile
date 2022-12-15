FROM node:lts-bullseye-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init
WORKDIR /usr
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --fund=false
COPY src ./src
RUN npm run build
RUN npm prune --omit "dev"

FROM node:lts-bullseye-slim
ARG VERSION
ENV npm_package_version=${VERSION}
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        file \
        librsvg2-bin \
        imagemagick \
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
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/bin/dumb-init /usr/bin/dumb-init
WORKDIR /usr/bin/app
COPY --from=build --chown=node:node /usr/package.json ./
COPY --from=build --chown=node:node /usr/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/dist ./
ENV NODE_ENV production
ENV DEBUG "c2c_images:*"
ENV SERVICE_PORT 8080
ENV METRICS_PORT 8081
EXPOSE 8080 8081
USER node
CMD ["dumb-init", "node", "server.js"]
