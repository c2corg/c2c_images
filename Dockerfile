FROM node:lts-alpine AS build

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
    ttf-ubuntu-font-family \
    font-croscore \
    ttf-cantarell \
    ttf-linux-libertine \
    ttf-liberation \
    ttf-droid \
    ttf-droid-nonlatin \
    msttcorefonts-installer

COPY --chown=node:node package.json package-lock.json tsconfig.json ./
COPY --chown=node:node src ./src
RUN npm install && npm run build

# Clean dev packages
RUN npm prune --omit "dev"

ENV DEBUG "c2c_images:*"
ENV SERVICE_PORT 8080
ENV METRICS_PORT 8081
EXPOSE 8080 8081

CMD ["npm", "start"]
