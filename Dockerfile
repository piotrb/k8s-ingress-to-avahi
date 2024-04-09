ARG NODE_VERSION=20

FROM node:$NODE_VERSION as builder

# RUN mkdir /app

WORKDIR /app

# Install app dependencies
COPY package*.json ./
COPY tsconfig.json ./

RUN npm install --frozen-lockfile

COPY src /app/src

RUN npm run build

#-----

FROM node:$NODE_VERSION-slim

ENV NODE_ENV production
USER node

WORKDIR /app

COPY --chown=node package*.json ./

RUN npm install --omit=dev --frozen-lockfile

COPY --chown=node --from=builder /app/dist ./dist

ENTRYPOINT [ "node", "-r", "source-map-support/register",  "dist/index.mjs" ]
