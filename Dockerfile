FROM node:lts-bullseye-slim AS pnpm

ARG PNPM_VERSION=7.6.0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

FROM pnpm AS builder
WORKDIR /usr/app
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.pnpm-store\
     pnpm fetch
COPY . ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.pnpm-store \
     pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm prune --prod

# --------------> The production image
FROM node:16.16-alpine3.15

ENV NODE_ENV production
WORKDIR /usr/app

RUN apk add dumb-init && mkdir db

USER node

COPY package.json ./
COPY --chown=node:node --from=builder /usr/app/dist ./
COPY --chown=node:node --from=builder /usr/app/node_modules ./node_modules

ENTRYPOINT ["dumb-init"]
CMD ["node", "--experimental-specifier-resolution=node", "/usr/app/index.js"]
