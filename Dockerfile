FROM node:lts-alpine AS build

RUN apk add --no-cache \
    librsvg \
    imagemagick

COPY --chown=node:node package.json package-lock.json tsconfig.json ./
COPY --chown=node:node src ./src
RUN npm install && npm run build

# Clean dev packages
RUN npm prune --production

ENV DEBUG "c2c_images:*"
ENV SERVICE_PORT 8080
ENV METRICS_PORT 8081
EXPOSE 8080 8081

CMD ["node", "dist/server.js"]
