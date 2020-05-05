FROM node:13-alpine

LABEL maintainer="Dennis Pfisterer, http://www.dennis-pfisterer.de"

# Install bind
RUN apk --update add bind && addgroup -S bind && adduser -S bind -G bind

# set our node environment, either development or production
ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

# Install  dependencies
WORKDIR /app
COPY package.json package-lock.json /app/
RUN npm install --no-optional && npm cache clean --force

# Install app
COPY src/ /app/

# UDP and TCP
EXPOSE 53

ENTRYPOINT ["node", "index.js"]
CMD [""]
