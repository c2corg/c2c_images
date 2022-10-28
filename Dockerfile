FROM node:lts-alpine AS build
RUN apk add --no-cache dumb-init
WORKDIR /usr
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --fund=false
COPY src ./src
RUN npm run build
RUN npm prune --omit "dev"

FROM node:lts-alpine
RUN apk add --no-cache \
    librsvg \
    imagemagick
RUN apk add --no-cache \
    terminus-font \
    ttf-inconsolata \
    ttf-dejavu \
    ttf-opensans \
    font-bitstream-100dpi \
    font-bitstream-75dpi \
    font-bitstream-speedo \
    font-bitstream-type1 \
    font-noto-all \
    ttf-font-awesome \
    font-croscore \
    ttf-cantarell \
    ttf-linux-libertine \
    ttf-liberation \
    ttf-droid \
    ttf-droid-nonlatin \
    msttcorefonts-installer
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
