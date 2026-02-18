#!/bin/sh
# Minimal HTTP healthcheck responder for Cloudron on port 8080
# Uses a simple shell loop with busybox nc
while true; do
  { printf 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK'; } | nc -l -p 8080 >/dev/null 2>&1 || sleep 1
done
