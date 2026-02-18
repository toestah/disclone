FROM coturn/coturn:alpine

USER root

# busybox nc is already in Alpine — no extra packages needed
COPY start.sh /app/start.sh
COPY healthcheck.sh /app/healthcheck.sh
RUN chmod +x /app/start.sh /app/healthcheck.sh

RUN mkdir -p /app/pkg
COPY CloudronManifest.json /app/pkg/CloudronManifest.json

CMD ["/bin/sh", "-c", "/app/healthcheck.sh & /app/start.sh"]
