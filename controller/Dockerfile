FROM node:22-alpine

LABEL maintainer="Dennis Pfisterer, http://www.dennis-pfisterer.de"

# Install dnssec-keygen and nsupdate
RUN apk add bind bind-tools

# set our node environment, either development or production
ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

# Install  dependencies
WORKDIR /app
COPY package.json package-lock.json /app/
RUN npm install --no-optional && npm cache clean --force

# Install app
COPY src/ /app/src/
COPY test/ /app/test

RUN npm run build

# Healthz
EXPOSE 7777 

ENTRYPOINT ["node", "src/index.js"]
CMD [""]
