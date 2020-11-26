FROM alpine

LABEL maintainer="Dennis Pfisterer, http://www.dennis-pfisterer.de"

# Install bind
RUN apk --update add bind bind-dnssec-tools && addgroup -S bind && adduser -S bind -G bind

# Install app
WORKDIR /app
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod a+x entrypoint.sh

# UDP and TCP for DNS
EXPOSE 53

VOLUME /etc/bind

ENTRYPOINT ["/app/entrypoint.sh"]
CMD [""]
